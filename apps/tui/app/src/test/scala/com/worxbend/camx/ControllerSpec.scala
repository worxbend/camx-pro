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

  test("small terminal retains STOP and quit instructions"):
    val app = Dashboard(Session(Demo()), true)
    val backend = HeadlessBackend(Size(60, 18))
    Pilot.using(backend)(app.runWith(backend)) { pilot =>
      pilot.waitUntil("resize guidance", 5.seconds)(pilot.screenText.contains("Resize to at least"))
      pilot.press("esc").press("q")
    }
