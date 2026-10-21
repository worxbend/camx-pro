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
  private val retarget = Signal(false)
  private val pan = TextInputState("0")
  private val tilt = TextInputState("0")
  private val step = TextInputState("1")
  private val moveSpeed = TextInputState("100")
  private val speed = TextInputState("4")
  private val acceleration = TextInputState("8")
  private val jerk = TextInputState("80")
  private val feelSpeed = TextInputState("100")
  private val feelAccel = TextInputState("100")
  private val feelJerk = TextInputState("100")
  private val slot = TextInputState("1")
  private val presetName = TextInputState("")
  private var scope: Option[TaskScope] = None
  private var generation = 0
  private var lastHeartbeat = 0L
  private var pending: Option[String] = None
  // A command issued while only a background poll or heartbeat was in flight; it runs as soon
  // as that request returns. STOP and connection loss discard it.
  private var deferred: Option[(String, Seq[(String, ujson.Value)])] = None
  private val motionOps = Set("arm", "move", "relative", "center", "preset_move")

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
    if session.owned || pending.exists(motionOps) then { val _ = Try(session.stop()) }
    session.close()
  override def bindings: KeyBindings = KeyBindings(
    binding("q", "quit")(quit()),
    binding("ctrl+c", "quit")(quit()),
    binding("esc", "STOP")(stop()),
    binding("ctrl+r", "confirm reference")(confirmReference()),
    binding("alt+left", "pan -")(nudge(-1, 0)), binding("alt+right", "pan +")(nudge(1, 0)),
    binding("alt+up", "tilt +")(nudge(0, 1)), binding("alt+down", "tilt -")(nudge(0, -1)),
    // Diagonals on the keys around a QWERTY keyboard's "h": y up-left, u up-right, b down-left, n down-right.
    binding("alt+y", "up-left")(nudge(-1, 1)), binding("alt+u", "up-right")(nudge(1, 1)),
    binding("alt+b", "down-left")(nudge(-1, -1)), binding("alt+n", "down-right")(nudge(1, -1))
  )
  private def extended: Boolean = snapshot.peek.exists(_.extended)
  private def perform(op: Option[String], fields: Seq[(String, ujson.Value)] = Seq.empty): Unit =
    if busy.peek && op.exists(_ != "heartbeat") && pending.forall(_ == "heartbeat") && deferred.isEmpty then
      deferred = op.map(_ -> fields)
    else if busy.peek then message.set("Wait for the pending request; Esc can always request STOP.")
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
              deferred.foreach { (next, nextFields) => deferred = None; perform(Some(next), nextFields) }
            case Right(None) => ()
            case Left(_) =>
              deferred = None
              connected.set(false)
              if session.owned || op.exists(motionOps) then stop()
              message.set("Connection failed; outcome unknown. No retry. Reconnect before continuing.")
      }
  private def stop(): Unit =
    generation += 1
    val stamp = generation
    busy.set(true); pending = Some("stop"); confirming.set(false); deferred = None
    val _ = scope.get.runCatching(session.stop()) { outcome =>
      if stamp == generation then
        busy.set(false); pending = None
        outcome match
          case Right(Some(s)) => snapshot.set(Some(s)); connected.set(true); message.set("STOP latched; holding torque. Support camera before release.")
          case _ => connected.set(false); message.set("STOP unconfirmed. Device watchdog remains the fallback.")
    }
  private def number(input: TextInputState): Option[Double] = input.value.toDoubleOption.filter(_.isFinite)
  private def percent(input: TextInputState): Option[Double] = number(input).filter(n => n >= 5 && n <= 100)
  private def requires11(feature: String): Boolean =
    if !extended then message.set(s"$feature needs firmware 1.1.0 (api_minor 1)."); extended
  /** Optional per-move fields; None when the entered speed is invalid. */
  private def moveOptions: Option[Seq[(String, ujson.Value)]] =
    if !extended then Some(Seq.empty)
    else percent(moveSpeed).map { p =>
      (if p < 100 then Seq("speed" -> ujson.Num(p / 100)) else Seq.empty) ++
        (if retarget.peek && snapshot.peek.exists(_.moving) then Seq("retarget" -> ujson.True) else Seq.empty)
    }
  /** Moving is allowed when idle, or while a move runs if retargeting is on. */
  private def mayTarget: Boolean =
    session.owned && snapshot.peek.exists(s => !s.stopped && (!s.moving || (extended && retarget.peek && !s.jogging)))
  private def target(op: String, fields: Seq[(String, ujson.Value)]): Unit =
    if !mayTarget then message.set("Reference and arm this session; wait until idle or enable Retarget.")
    else moveOptions match
      case Some(options) => perform(Some(op), fields ++ options)
      case None => message.set("Move speed must be 5–100 %.")
  private def coordinates(op: String): Unit =
    (number(pan), number(tilt)) match
      case (Some(p), Some(t)) =>
        val fields = Seq("pan" -> ujson.Num(p), "tilt" -> ujson.Num(t))
        if op == "move" then target(op, fields) else perform(Some(op), fields)
      case _ => message.set("Enter finite pan and tilt angles.")
  private def confirmReference(): Unit =
    if confirming.peek then { confirming.set(false); coordinates("reference") }
  private def nudge(p: Int, t: Int): Unit =
    number(step) match
      case Some(n) if n > 0 && n <= 5 => target("relative", Seq("pan" -> ujson.Num(p * n), "tilt" -> ujson.Num(t * n)))
      case _ => message.set("Step must be greater than 0 and at most 5 degrees.")
  private def selectedSlot: Option[Int] = slot.value.toIntOption.filter(n => n >= 1 && n <= 8).map(_ - 1)
  /** The entered name, if any; Left with a message when it cannot be sent. */
  private def nameField: Either[String, Seq[(String, ujson.Value)]] =
    val name = presetName.value.trim
    if name.isEmpty then Right(Seq.empty)
    else if !State.validName(name) then Left("Name: up to 16 printable ASCII characters, without \" or \\.")
    else if !extended then Left("Preset names need firmware 1.1.0 (api_minor 1).")
    else Right(Seq("name" -> ujson.Str(name)))
  private def preset(action: String): Unit =
    selectedSlot match
      case None => message.set("Slot must be 1–8.")
      case Some(n) =>
        val slotField = Seq("slot" -> ujson.Num(n))
        action match
          case "recall" => target("preset_move", slotField)
          case "clear" => if requires11("Clearing a preset") then perform(Some("preset_clear"), slotField)
          case _ =>
            nameField match
              case Left(problem) => message.set(problem)
              case Right(named) if action == "here" =>
                if requires11("Saving the present pose") then perform(Some("preset_save"), slotField ++ named)
              case Right(named) =>
                (number(pan), number(tilt)) match
                  case (Some(p), Some(t)) => perform(Some("preset_set"), slotField ++ Seq("pan" -> ujson.Num(p), "tilt" -> ujson.Num(t)) ++ named)
                  case _ => message.set("Coordinates must be finite.")
  private def feel(): Unit =
    if requires11("Motion feel") then
      (percent(feelSpeed), percent(feelAccel), percent(feelJerk)) match
        case (Some(s), Some(a), Some(j)) =>
          perform(Some("motion"), Seq("speed" -> ujson.Num(s / 100), "accel" -> ujson.Num(a / 100), "jerk" -> ujson.Num(j / 100)))
        case _ => message.set("Feel percentages must each be 5–100.")
  private def profile(): Unit =
    (number(speed), number(acceleration), number(jerk)) match
      case (Some(s), Some(a), j) if s >= 0.1 && s <= 8 && a >= 0.1 && a <= 20 && (!extended || j.exists(n => n >= 1 && n <= 500)) =>
        val jerkFields = if extended then j.toSeq.flatMap(n => Seq("pan_jerk" -> ujson.Num(n), "tilt_jerk" -> ujson.Num(n))) else Seq.empty
        perform(Some("settings"), Seq("pan_speed" -> ujson.Num(s), "tilt_speed" -> ujson.Num(s), "pan_accel" -> ujson.Num(a), "tilt_accel" -> ujson.Num(a)) ++ jerkFields)
      case _ => message.set("Speed: 0.1–8 deg/s; acceleration: 0.1–20 deg/s2; jerk: 1–500 deg/s3.")
  private def useLastPose(): Unit =
    snapshot.peek.flatMap(_.lastPose) match
      case Some(pose) =>
        pan.setValue(f"${pose.pan}%.2f"); tilt.setValue(f"${pose.tilt}%.2f")
        message.set("Angles filled from the last release. Align physically, then Reference... and Ctrl+r.")
      case None => message.set("No last-pose hint: release a referenced, resting mechanism first.")
  private def presetLabel(index: Int, p: Preset): String =
    s"${index + 1}:${if !p.valid then "-" else if p.name.nonEmpty then p.name.take(7) else "saved"}"

  def view(using ReactiveScope, Theme): Element = responsive { size =>
    if size.width < 76 || size.height < 27 then
      panel("CAMX Pro")(text("Resize to at least 76 x 27. Esc: STOP / q: quit."), text(message.get)).rounded
    else
      val state = snapshot.get
      val modern = state.exists(_.extended)
      val status = if !connected.get then "DISCONNECTED" else if state.exists(_.stopped) then "STOP LATCHED" else if state.exists(_.queued) then "RETARGETING" else if state.exists(_.moving) then "MOVING" else if state.exists(_.armed) then "ARMED / HOLDING" else "RELEASED"
      val eta = state.filter(s => s.moving && s.eta > 0).map(s => f" ${s.eta}%.1f s").getOrElse("")
      val position = state.map(s => f"PAN ${s.axes(0).degrees}%8.2f deg    TILT ${s.axes(1).degrees}%8.2f deg").getOrElse("PAN       -- deg    TILT       -- deg")
      val feelNow = state.flatMap(_.scales).map(m => f"now ${m.speed * 100}%.0f/${m.accel * 100}%.0f/${m.jerk * 100}%.0f").getOrElse("")
      column(
        topBar("CAMX PRO / REMOTE", right = if demo then "DEMO / no hardware" else "ESP32 / trusted LAN").length(1),
        text(s"$status$eta  |  ${if state.exists(_.referenced) then "OPEN-LOOP ESTIMATE" else "UNREFERENCED"}  |  ${if busy.get then "REQUEST PENDING" else "IDLE"}${if state.exists(_.dirty) then "  |  UNSAVED" else ""}").bold.length(1),
        panel("POSITION / pan 4:1 planetary, tilt 2:1 belt")(
          text(position).bold.fg(Color.Cyan),
          text(state.map(s => s"Limits: pan ${s.axes(0).minimum}..${s.axes(0).maximum}, tilt ${s.axes(1).minimum}..${s.axes(1).maximum} deg").getOrElse("Read state before issuing commands.")),
          row(text("Pan deg ").length(9), input(pan, "0").key("pan").length(12), text(" Tilt deg ").length(11), input(tilt, "0").key("tilt").length(12), text(" Step ").length(7), input(step, "1").key("step").length(8)).length(1),
          row(button("Move target")(coordinates("move")).length(17), button("Zero")(target("center", Seq.empty)).length(10), button("Pan -")(nudge(-1, 0)).length(10), button("Pan +")(nudge(1, 0)).length(10), button("Tilt -")(nudge(0, -1)).length(10), button("Tilt +")(nudge(0, 1)).length(10)).length(1),
          row(text("Diagonal ").length(10), button("Up-left")(nudge(-1, 1)).length(13), button("Up-right")(nudge(1, 1)).length(14), button("Down-left")(nudge(-1, -1)).length(15), button("Down-right")(nudge(1, -1)).length(16)).length(1)
        ).rounded.length(7),
        panel("SESSION / reference is physical, not automatic homing")(
          row(button("Reference...") { confirming.set(true); message.set("Align both axes to the entered angles with coils released; Ctrl+r confirms.") }.length(19), button("Arm")(perform(Some("arm"))).length(10), button("Release coils")(perform(Some("disarm"))).length(18), button("STOP / Esc")(stop()).length(16), button("Reconnect")(perform(None)).length(14)).length(1),
          text(if confirming.get then "Physically aligned to entered angles? Ctrl+r confirms. Esc cancels + STOP." else "Support camera before release. Release invalidates reference; leaving sends STOP.").dim,
          state.flatMap(_.lastPose) match
            case Some(pose) => row(text(f"Last release: pan ${pose.pan}%.2f, tilt ${pose.tilt}%.2f (hint only) ").length(52), button("Use last pose")(useLastPose()).length(18)).length(1)
            case None => text(if modern then "No last-pose hint yet." else "Last-pose hint needs firmware 1.1.0.").dim.length(1)
        ).rounded.length(5),
        panel("PRESETS / Save: entered angles, released / Here: present pose")(
          row(text("Slot 1-8 ").length(11), input(slot, "1").key("slot").length(5), text(" Name ").length(7), input(presetName, "optional").key("name").length(20)).length(1),
          row(button("Save target")(preset("save")).length(16), button("Save here")(preset("here")).length(14), button("Clear")(preset("clear")).length(10), button("Recall")(preset("recall")).length(11)).length(1),
          text(state.map(_.presets.zipWithIndex.map((p, i) => presetLabel(i, p)).mkString(" ")).getOrElse("No preset data"))
        ).rounded.length(5),
        panel("MOTION / feel is runtime; profile is stored, released only")(
          if modern then
            row(text("Feel % speed ").length(14), input(feelSpeed, "100").key("feel-speed").length(6), text(" accel ").length(8), input(feelAccel, "100").key("feel-accel").length(6), text(" jerk ").length(7), input(feelJerk, "100").key("feel-jerk").length(6), button("Apply feel")(feel()).length(14), text(s" $feelNow").length(15)).length(1)
          else text("Motion feel, move speed and retargeting need firmware 1.1.0.").dim.length(1),
          if modern then
            row(text("Move speed % ").length(14), input(moveSpeed, "100").key("move-speed").length(6), text(" ").length(2), checkbox("Retarget while moving", retarget).length(26)).length(1)
          else text("Profile below applies speed and acceleration to both axes.").dim.length(1),
          row(text("Speed deg/s ").length(13), input(speed, "4").key("speed").length(6), text(" Accel ").length(8), input(acceleration, "8").key("accel").length(6), text(if modern then " Jerk " else "").length(7), input(jerk, "80").key("jerk").length(if modern then 6 else 0), button("Apply profile")(profile()).length(17)).length(1)
        ).rounded.length(5),
        text(message.get).fg(Color.Yellow).fill,
        text("Alt+arrows: step | Alt+y/u/b/n: diagonal | Esc: STOP | Tab: focus | q: quit").dim.length(1)
      )
  }
