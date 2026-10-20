package com.worxbend.camx

import io.worxbend.tui.dsl.*
import io.worxbend.tui.widgets.TextInputState
import scala.concurrent.duration.DurationInt
import scala.util.Try

final class Dashboard(val session: Session, demo: Boolean) extends TuiApp:
  val snapshot = Signal(Option.empty[State])
  val message = Signal("Connecting; motors remain released.")
  private val busy = Signal(false)
  private val connected = Signal(false)
  private val confirming = Signal(false)
  private val pan = TextInputState("0")
  private val tilt = TextInputState("0")
  private val step = TextInputState("1")
  private val speed = TextInputState("4")
  private val acceleration = TextInputState("8")
  private val slot = TextInputState("1")
  private var scope: Option[TaskScope] = None
  private var generation = 0
  private var lastHeartbeat = 0L
  private var pending: Option[String] = None

  override def onStart(): Unit =
    scope = Some(Async.scope())
    perform(None)
    val _ = scope.get.every(500.millis) {
      if connected.peek && !busy.peek then
        if session.owned && System.nanoTime() - lastHeartbeat >= 1000000000L then perform(Some("heartbeat"))
        else perform(None)
    }
  override def onStop(): Unit =
    generation += 1
    scope.foreach(_.close())
    // A pending arm may have reached hardware even before the response arrives.
    if session.owned || pending.exists(Set("arm", "move", "relative", "center", "preset_move")) then { val _ = Try(session.stop()) }
    session.close()
  override def bindings: KeyBindings = KeyBindings(
    binding("q", "quit")(quit()),
    binding("ctrl+c", "quit")(quit()),
    binding("esc", "STOP")(stop()),
    binding("ctrl+r", "confirm reference")(confirmReference()),
    binding("alt+left", "pan -")(nudge(-1, 0)), binding("alt+right", "pan +")(nudge(1, 0)),
    binding("alt+up", "tilt +")(nudge(0, 1)), binding("alt+down", "tilt -")(nudge(0, -1))
  )
  private def perform(op: Option[String], fields: Seq[(String, ujson.Value)] = Seq.empty): Unit =
    if busy.peek then message.set("Wait for the pending request; Esc can always request STOP.")
    else if op.isDefined && !connected.peek then message.set("Reconnect and inspect the mechanism first.")
    else
      busy.set(true); pending = op
      val stamp = generation
      val _ = scope.get.runCatching(session.request(op, fields)) { outcome =>
        if stamp == generation then
          busy.set(false); pending = None
          outcome match
            case Right(Some(s)) =>
              snapshot.set(Some(s)); connected.set(true)
              if op.contains("heartbeat") || op.contains("arm") then lastHeartbeat = System.nanoTime()
              if op.exists(_ != "heartbeat") then message.set(s"${op.get}: ${s.result}")
              else if message.peek.startsWith("Connecting") then message.set("Connected. Align physically, reference, then arm.")
            case Right(None) => ()
            case Left(_) =>
              connected.set(false)
              if session.owned || op.exists(Set("arm", "move", "relative", "center", "preset_move")) then stop()
              message.set("Connection failed; outcome unknown. No retry. Reconnect before continuing.")
      }
  private def stop(): Unit =
    generation += 1
    val stamp = generation
    busy.set(true); pending = Some("stop"); confirming.set(false)
    val _ = scope.get.runCatching(session.stop()) { outcome =>
      if stamp == generation then
        busy.set(false); pending = None
        outcome match
          case Right(Some(s)) => snapshot.set(Some(s)); connected.set(true); message.set("STOP latched; holding torque. Support camera before release.")
          case _ => connected.set(false); message.set("STOP unconfirmed. Device watchdog remains the fallback.")
    }
  private def number(input: TextInputState): Option[Double] = input.value.toDoubleOption.filter(_.isFinite)
  private def coordinates(op: String): Unit =
    (number(pan), number(tilt)) match
      case (Some(p), Some(t)) => perform(Some(op), Seq("pan" -> ujson.Num(p), "tilt" -> ujson.Num(t)))
      case _ => message.set("Enter finite pan and tilt angles.")
  private def confirmReference(): Unit =
    if confirming.peek then { confirming.set(false); coordinates("reference") }
  private def nudge(p: Int, t: Int): Unit =
    if !session.owned || snapshot.peek.exists(s => s.moving || s.stopped) then message.set("Reference and arm this session; wait until idle.")
    else number(step) match
      case Some(n) if n > 0 && n <= 5 => perform(Some("relative"), Seq("pan" -> ujson.Num(p * n), "tilt" -> ujson.Num(t * n)))
      case _ => message.set("Step must be greater than 0 and at most 5 degrees.")
  private def preset(save: Boolean): Unit =
    (slot.value.toIntOption, number(pan), number(tilt)) match
      case (Some(n), Some(p), Some(t)) if n >= 1 && n <= 8 =>
        val fields = Seq("slot" -> ujson.Num(n - 1)) ++ (if save then Seq("pan" -> ujson.Num(p), "tilt" -> ujson.Num(t)) else Seq.empty)
        perform(Some(if save then "preset_set" else "preset_move"), fields)
      case _ => message.set("Slot must be 1–8; coordinates must be finite.")
  private def profile(): Unit =
    (number(speed), number(acceleration)) match
      case (Some(s), Some(a)) if s >= 0.1 && s <= 8 && a >= 0.1 && a <= 20 =>
        perform(Some("settings"), Seq("pan_speed" -> ujson.Num(s), "tilt_speed" -> ujson.Num(s), "pan_accel" -> ujson.Num(a), "tilt_accel" -> ujson.Num(a)))
      case _ => message.set("Speed: 0.1–8 degrees/s; acceleration: 0.1–20 degrees/s2.")

  def view(using ReactiveScope, Theme): Element = responsive { size =>
    if size.width < 76 || size.height < 27 then
      panel("CAMX Pro")(text("Resize to at least 76 x 27. Esc: STOP / q: quit."), text(message.get)).rounded
    else
      val state = snapshot.get
      val status = if !connected.get then "DISCONNECTED" else if state.exists(_.stopped) then "STOP LATCHED" else if state.exists(_.moving) then "MOVING" else if state.exists(_.armed) then "ARMED / HOLDING" else "RELEASED"
      val position = state.map(s => f"PAN ${s.axes(0).degrees}%8.2f deg    TILT ${s.axes(1).degrees}%8.2f deg").getOrElse("PAN       -- deg    TILT       -- deg")
      column(
        topBar("CAMX PRO / REMOTE", right = if demo then "DEMO / no hardware" else "ESP32 / trusted LAN").length(1),
        text(s"$status  |  ${if state.exists(_.referenced) then "OPEN-LOOP ESTIMATE" else "UNREFERENCED"}  |  ${if busy.get then "REQUEST PENDING" else "IDLE"}").bold.length(1),
        panel("POSITION / pan 4:1 planetary, tilt 2:1 belt")(
          text(position).bold.fg(Color.Cyan),
          text(state.map(s => s"Limits: pan ${s.axes(0).minimum}..${s.axes(0).maximum}, tilt ${s.axes(1).minimum}..${s.axes(1).maximum} deg").getOrElse("Read state before issuing commands.")),
          row(text("Pan deg ").length(9), input(pan, "0").key("pan").length(12), text(" Tilt deg ").length(11), input(tilt, "0").key("tilt").length(12), text(" Step ").length(7), input(step, "1").key("step").length(8)).length(1),
          row(button("Move target")(coordinates("move")).length(17), button("Zero")(perform(Some("center"))).length(10), button("Pan -")(nudge(-1, 0)).length(10), button("Pan +")(nudge(1, 0)).length(10), button("Tilt -")(nudge(0, -1)).length(10), button("Tilt +")(nudge(0, 1)).length(10)).length(1)
        ).rounded.length(6),
        panel("SESSION / reference is physical, not automatic homing")(
          row(button("Reference...") { confirming.set(true); message.set("Align both axes to the entered angles with coils released; Ctrl+r confirms.") }.length(19), button("Arm")(perform(Some("arm"))).length(10), button("Release coils")(perform(Some("disarm"))).length(18), button("STOP / Esc")(stop()).length(16), button("Reconnect")(perform(None)).length(14)).length(1),
          text(if confirming.get then "Physically aligned to entered angles? Ctrl+r confirms. Esc cancels + STOP." else "Support camera before release. Release invalidates reference; leaving sends STOP.").dim
        ).rounded.length(4),
        panel("PRESETS / explicit entered angles; save while released")(
          row(text("Slot 1-8 ").length(11), input(slot, "1").key("slot").length(5), button("Save target")(preset(true)).length(18), button("Recall")(preset(false)).length(14)).length(1),
          text(state.map(_.presets.zipWithIndex.map((p, i) => s"${i + 1}:${if p.valid then "saved" else "empty"}").mkString("  ")).getOrElse("No preset data"))
        ).rounded.length(4),
        panel("PROFILE / released only; fresh reference required")(
          row(text("Speed deg/s ").length(14), input(speed, "4").key("speed").length(7), text(" Accel deg/s2 ").length(15), input(acceleration, "8").key("accel").length(7), button("Apply")(profile()).length(12)).length(1)
        ).rounded.length(3),
        text(message.get).fg(Color.Yellow).fill,
        text("Alt+arrows: bounded step | Esc: STOP | Tab: focus | q: quit | USB video separate").dim.length(1)
      )
  }
