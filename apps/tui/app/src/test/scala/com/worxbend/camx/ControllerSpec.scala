package com.worxbend.camx

import org.scalatest.funsuite.AnyFunSuite
import io.worxbend.tui.core.Size
import io.worxbend.tui.terminal.HeadlessBackend
import io.worxbend.tui.testsupport.Pilot
import java.net.{InetSocketAddress, URI}
import com.sun.net.httpserver.HttpServer
import java.nio.file.{Files, Path}
import java.util.concurrent.{CountDownLatch, TimeUnit}
import scala.concurrent.duration.DurationInt

final class ControllerSpec extends AnyFunSuite:
  test("parse the actual C++ API fixture and reject incompatible versions"):
    val root = Iterator.iterate(Path.of("").toAbsolutePath)(_.getParent).takeWhile(_ != null)
      .find(p => Files.exists(p.resolve("contracts/state-v1.json"))).get
    val value = ujson.read(Files.readString(root.resolve("contracts/state-v1.json")))
    val state = State.parse(value)
    assert(state.axes.map(_.reduction) == Vector(4, 2))
    value("api") = 2
    intercept[IllegalArgumentException](State.parse(value))

  test("sequence follows rotated epoch, arm is explicit, released state cannot move"):
    val session = Session(Demo())
    val initial = session.request().get
    intercept[IllegalArgumentException](session.request(Some("move")))
    val referenced = session.request(Some("reference"), Seq("pan" -> ujson.Num(0), "tilt" -> ujson.Num(0))).get
    assert(referenced.epoch != initial.epoch)
    assert(!session.owned)
    assert(session.request(Some("arm")).get.armed)
    assert(session.owned)
    val move = session.request(Some("relative"), Seq("pan" -> ujson.Num(1), "tilt" -> ujson.Num(-1))).get
    assert(move.axes.map(_.degrees) == Vector(1, -1))
    assert(session.stop().get.stopped)
    assert(!session.owned)
    session.close()

  test("STOP generation suppresses a late ARM response"):
    val entered = CountDownLatch(1)
    val unblock = CountDownLatch(1)
    val demo = Demo()
    val transport = new Transport:
      def exchange(command: Option[ujson.Obj]): State =
        val result = demo.exchange(command)
        if command.exists(_("op").str == "arm") then
          entered.countDown()
          assert(unblock.await(5, TimeUnit.SECONDS))
        result
    val session = Session(transport)
    session.request()
    session.request(Some("reference"), Seq("pan" -> ujson.Num(0), "tilt" -> ujson.Num(0)))
    val thread = Thread.ofVirtual().start(() => { val _ = session.request(Some("arm")) })
    assert(entered.await(5, TimeUnit.SECONDS))
    assert(session.stop().get.stopped)
    unblock.countDown(); thread.join()
    assert(session.state.get.stopped && !session.owned)
    session.close()

  test("HTTP transport sends bearer and length, never follows a redirect with credentials"):
    val demo = Demo()
    val count = new java.util.concurrent.atomic.AtomicInteger()
    val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
    server.createContext("/api/state", exchange => {
      assert(exchange.getRequestHeaders.getFirst("Authorization") == "Bearer test-token-123456789")
      val bytes = ujson.write(demo.exchange(None).raw).getBytes(java.nio.charset.StandardCharsets.UTF_8)
      exchange.sendResponseHeaders(200, bytes.length); exchange.getResponseBody.write(bytes); exchange.close()
    })
    server.createContext("/api/command", exchange => {
      assert(exchange.getRequestHeaders.getFirst("Content-Length") != null)
      count.incrementAndGet()
      exchange.getResponseHeaders.add("Location", "/capture")
      exchange.sendResponseHeaders(302, -1); exchange.close()
    })
    server.createContext("/capture", exchange => { count.addAndGet(100); exchange.close() })
    server.start()
    val transport = DeviceTransport(URI.create(s"http://127.0.0.1:${server.getAddress.getPort}"), "test-token-123456789")
    try
      assert(!transport.exchange(None).armed)
      intercept[Exception](transport.exchange(Some(ujson.Obj("op" -> "stop"))))
      assert(count.get() == 1)
    finally transport.close(); server.stop(0)

  test("Glyphora headless interface connects, confirms reference, moves, stops and holds on STOP"):
    val calls = scala.collection.mutable.ArrayBuffer.empty[String]
    val demo = Demo()
    val transport = new Transport:
      def exchange(command: Option[ujson.Obj]): State =
        calls.synchronized { calls += command.fold("state")(_("op").str) }
        demo.exchange(command)
    val app = Dashboard(Session(transport), true)
    val backend = HeadlessBackend(Size(120, 34))
    Pilot.using(backend)(app.runWith(backend)) { pilot =>
      pilot.waitUntil("connected")(app.snapshot.peek.nonEmpty)
      def click(label: String): Unit =
        pilot.waitUntil(s"$label button")(pilot.screenText.contains(label))
        val row = pilot.screenLines.indexWhere(_.contains(label))
        val col = pilot.screenLines(row).indexOf(label)
        pilot.click(col + 2, row)
      click("Reference...")
      pilot.press("ctrl+r")
      pilot.waitUntil("referenced")(app.snapshot.peek.exists(_.referenced))
      click("Arm")
      pilot.waitUntil("armed")(app.snapshot.peek.exists(_.armed))
      click("Pan +")
      pilot.waitUntil("moved")(app.snapshot.peek.exists(_.axes.head.degrees == 1))
      pilot.press("esc")
      pilot.waitUntil("stop")(app.snapshot.peek.exists(_.stopped))
      assert(pilot.screenText.contains("DEMO / no hardware"))
      pilot.waitUntil("stop frame")(pilot.screenText.contains("STOP LATCHED"))
      pilot.press("q")
    }
    assert(calls.synchronized(calls.contains("stop")))

  /** The same state as firmware 1.0.0 would send it: no 1.1.0 fields at all. */
  private def legacy(value: ujson.Value): ujson.Value =
    val copy = ujson.read(ujson.write(value))
    Seq("api_minor", "queued", "eta", "motion", "max_tick_cost_us", "last_pose").foreach(copy.obj.remove)
    copy("axes").arr.foreach(a => Seq("jerk", "accel_now").foreach(a.obj.remove))
    copy("presets").arr.foreach(_.obj.remove("name"))
    copy

  test("parse firmware 1.1 fields when present; 1.0 states parse with the new features off"):
    val root = Iterator.iterate(Path.of("").toAbsolutePath)(_.getParent).takeWhile(_ != null)
      .find(p => Files.exists(p.resolve("contracts/state-v1.json"))).get
    val value = ujson.read(Files.readString(root.resolve("contracts/state-v1.json")))
    val state = State.parse(value)
    assert(state.apiMinor == 1 && state.extended)
    assert(state.scales.contains(Scales(1, 1, 1)))
    assert(state.axes.map(_.jerk) == Vector(Some(80.0), Some(80.0)))
    assert(state.presets.forall(_.name.isEmpty) && state.lastPose.isEmpty && !state.queued)
    val old = State.parse(legacy(value))
    assert(old.apiMinor == 0 && !old.extended && old.scales.isEmpty && old.lastPose.isEmpty)
    assert(old.axes.map(_.reduction) == Vector(4, 2))
    for broken <- Seq[ujson.Value => Unit](
        v => v("motion")("speed") = 0, v => v("presets")(2)("name") = "caf\u00e9", v => v("eta") = -1,
        v => v.obj.remove("last_pose"), v => v("axes")(0).obj.remove("jerk"), v => v("api_minor") = 1.5) do
      val copy = ujson.read(ujson.write(value))
      broken(copy)
      intercept[Exception](State.parse(copy))
    val pose = ujson.read(ujson.write(value))
    pose("last_pose") = ujson.Obj("valid" -> true, "pan" -> 3.5, "tilt" -> -1)
    assert(State.parse(pose).lastPose.contains(Pose(3.5, -1)))

  test("demo models 1.1 commands: motion scales, named presets, present pose, clear, last pose"):
    val session = Session(Demo())
    session.request()
    assert(session.request(Some("motion"), Seq("speed" -> ujson.Num(0.5))).get.scales.contains(Scales(0.5, 1, 1)))
    assert(session.request(Some("motion"), Seq("jerk" -> ujson.Num(0))).get.result == "range")
    assert(session.request(Some("preset_save"), Seq("slot" -> ujson.Num(0))).get.result == "not_referenced")
    session.request(Some("reference"), Seq("pan" -> ujson.Num(2), "tilt" -> ujson.Num(-1)))
    val saved = session.request(Some("preset_save"), Seq("slot" -> ujson.Num(0), "name" -> ujson.Str("Desk"))).get
    assert(saved.presets.head == Preset(true, 2, -1, "Desk"))
    assert(session.request(Some("preset_set"), Seq("slot" -> ujson.Num(0), "pan" -> ujson.Num(1), "tilt" -> ujson.Num(1))).get.presets.head.name == "Desk")
    assert(session.request(Some("preset_set"), Seq("slot" -> ujson.Num(1), "pan" -> ujson.Num(1), "tilt" -> ujson.Num(1), "name" -> ujson.Str("x" * 17))).get.result == "invalid")
    assert(!session.request(Some("preset_clear"), Seq("slot" -> ujson.Num(0))).get.presets.head.valid)
    assert(session.request(Some("disarm")).get.lastPose.contains(Pose(2, -1)))
    session.close()

  test("headless interface: diagonal keys and buttons, named preset of the present pose, feel, last pose"):
    val calls = scala.collection.mutable.ArrayBuffer.empty[ujson.Obj]
    val demo = Demo()
    val transport = new Transport:
      def exchange(command: Option[ujson.Obj]): State =
        command.foreach(c => calls.synchronized { calls += c })
        demo.exchange(command)
    val app = Dashboard(Session(transport), true)
    val backend = HeadlessBackend(Size(120, 34))
    Pilot.using(backend)(app.runWith(backend)) { pilot =>
      pilot.waitUntil("connected")(app.snapshot.peek.nonEmpty)
      def at(label: String): (Int, Int) =
        pilot.waitUntil(s"$label on screen")(pilot.screenText.contains(label))
        val row = pilot.screenLines.indexWhere(_.contains(label))
        (pilot.screenLines(row).indexOf(label), row)
      def click(label: String): Unit = { val (col, row) = at(label); pilot.click(col + 2, row) }
      def degrees = app.snapshot.peek.get.axes.map(_.degrees)
      click("Reference...")
      pilot.press("ctrl+r")
      pilot.waitUntil("referenced")(app.snapshot.peek.exists(_.referenced))
      click("Arm")
      pilot.waitUntil("armed")(app.snapshot.peek.exists(_.armed))
      pilot.press("alt+u")
      pilot.waitUntil("up-right step")(degrees == Vector(1.0, 1.0))
      pilot.press("alt+b")
      pilot.waitUntil("down-left step")(degrees == Vector(0.0, 0.0))
      click("Down-right")
      pilot.waitUntil("down-right step")(degrees == Vector(1.0, -1.0))
      assert(calls.synchronized(calls.exists(c => c("op").str == "relative" && c("pan").num == 1 && c("tilt").num == -1)))
      // Name the present pose and save it while armed, then clear it.
      click("optional")
      pilot.typeText("Desk")
      click("Save here")
      pilot.waitUntil("named preset")(app.snapshot.peek.exists(_.presets.head == Preset(true, 1, -1, "Desk")))
      pilot.waitUntil("preset list")(pilot.screenText.contains("1:Desk"))
      click("Clear")
      pilot.waitUntil("cleared")(app.snapshot.peek.exists(!_.presets.head.valid))
      // Motion feel: replace 100 with 50 in the speed field and apply.
      val (col, row) = at("Feel % speed")
      pilot.click(col + 16, row)
      pilot.press("end", "backspace", "backspace", "backspace")
      pilot.typeText("50")
      click("Apply feel")
      pilot.waitUntil("feel applied")(app.snapshot.peek.flatMap(_.scales).contains(Scales(0.5, 1, 1)))
      assert(app.snapshot.peek.exists(_.referenced))
      // Release leaves a last-pose hint that fills the angle fields.
      click("Release coils")
      pilot.waitUntil("hint")(pilot.screenText.contains("Last release: pan 1.00, tilt -1.00"))
      click("Use last pose")
      pilot.waitUntil("filled")(app.message.peek.startsWith("Angles filled"))
      assert(pilot.screenText.contains("Alt+y/u/b/n: diagonal"))
      pilot.press("q")
    }

  test("a step pressed while a status poll is in flight runs when the poll returns"):
    val demo = Demo()
    @volatile var gate: Option[CountDownLatch] = None
    val blocked = CountDownLatch(1)
    val transport = new Transport:
      def exchange(command: Option[ujson.Obj]): State =
        if command.isEmpty then gate.foreach { latch => blocked.countDown(); assert(latch.await(5, TimeUnit.SECONDS)) }
        demo.exchange(command)
    val app = Dashboard(Session(transport), true)
    val backend = HeadlessBackend(Size(120, 34))
    Pilot.using(backend)(app.runWith(backend)) { pilot =>
      pilot.waitUntil("connected")(app.snapshot.peek.nonEmpty)
      def click(label: String): Unit =
        pilot.waitUntil(s"$label button")(pilot.screenText.contains(label))
        val row = pilot.screenLines.indexWhere(_.contains(label))
        pilot.click(pilot.screenLines(row).indexOf(label) + 2, row)
      click("Reference...")
      pilot.press("ctrl+r")
      pilot.waitUntil("referenced")(app.snapshot.peek.exists(_.referenced))
      click("Arm")
      pilot.waitUntil("armed")(app.snapshot.peek.exists(_.armed))
      val latch = CountDownLatch(1)
      gate = Some(latch)
      assert(blocked.await(5, TimeUnit.SECONDS)) // a background poll is now in flight
      gate = None
      pilot.press("alt+n")
      latch.countDown()
      pilot.waitUntil("deferred step ran")(app.snapshot.peek.exists(_.axes.map(_.degrees) == Vector(1.0, -1.0)))
      pilot.press("q")
    }

  test("minimum 76 x 27 terminal still shows every new control"):
    val app = Dashboard(Session(Demo()), true)
    val backend = HeadlessBackend(Size(76, 27))
    Pilot.using(backend)(app.runWith(backend)) { pilot =>
      pilot.waitUntil("connected")(app.snapshot.peek.nonEmpty)
      for label <- Seq("Down-right", "Save here", "Clear", "Recall", "Apply feel", "Retarget while moving", "Apply profile", "Jerk", "STOP / Esc") do
        pilot.waitUntil(s"$label visible", 5.seconds)(pilot.screenText.contains(label))
      pilot.press("q")
    }

  test("firmware 1.0 hides 1.1 features and never sends their commands"):
    val calls = scala.collection.mutable.ArrayBuffer.empty[String]
    val demo = Demo()
    val transport = new Transport:
      def exchange(command: Option[ujson.Obj]): State =
        command.foreach(c => calls.synchronized { calls += c("op").str })
        State.parse(legacy(demo.exchange(command).raw))
    val app = Dashboard(Session(transport), true)
    val backend = HeadlessBackend(Size(120, 34))
    Pilot.using(backend)(app.runWith(backend)) { pilot =>
      pilot.waitUntil("connected")(app.snapshot.peek.exists(!_.extended))
      pilot.waitUntil("notice")(pilot.screenText.contains("need firmware 1.1.0"))
      assert(!pilot.screenText.contains("Apply feel") && !pilot.screenText.contains("Retarget while moving"))
      def click(label: String): Unit =
        pilot.waitUntil(s"$label button")(pilot.screenText.contains(label))
        val row = pilot.screenLines.indexWhere(_.contains(label))
        pilot.click(pilot.screenLines(row).indexOf(label) + 2, row)
      click("Save here")
      pilot.waitUntil("refused locally")(app.message.peek.contains("needs firmware 1.1.0"))
      click("Clear")
      pilot.waitUntil("refused locally")(app.message.peek.startsWith("Clearing a preset needs"))
      pilot.press("q")
    }
    assert(calls.synchronized(!calls.exists(Set("preset_save", "preset_clear", "motion"))))

  test("small terminal retains STOP and quit instructions"):
    val app = Dashboard(Session(Demo()), true)
    val backend = HeadlessBackend(Size(60, 18))
    Pilot.using(backend)(app.runWith(backend)) { pilot =>
      pilot.waitUntil("resize guidance", 5.seconds)(pilot.screenText.contains("Resize to at least"))
      pilot.press("esc").press("q")
    }
