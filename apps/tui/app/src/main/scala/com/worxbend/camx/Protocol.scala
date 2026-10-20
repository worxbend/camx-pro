package com.worxbend.camx

import java.net.URI
import java.net.http.{HttpClient, HttpRequest}
import java.time.Duration
import scala.util.Try

final case class Axis(degrees: Double, minimum: Double, maximum: Double, speed: Double, reduction: Double)
final case class Preset(valid: Boolean, pan: Double, tilt: Double)
final case class State(epoch: Long, seq: Long, result: String, armed: Boolean, referenced: Boolean,
    stopped: Boolean, moving: Boolean, axes: Vector[Axis], presets: Vector[Preset], raw: ujson.Value)
object State:
  def parse(value: ujson.Value): State =
    require(value("api").num == 1, "Unsupported API")
    def uint(name: String): Long =
      val number = value(name).num
      require(number.isWhole && number >= 0 && number <= 4294967295L, "Invalid session counter")
      number.toLong
    def number(v: ujson.Value): Double =
      val n = v.num
      require(n.isFinite, "Invalid numeric value")
      n
    val axes = value("axes").arr.toVector.map { a =>
      val axis = Axis(number(a("degrees")), number(a("minimum")), number(a("maximum")), number(a("speed")), number(a("reduction")))
      require(axis.minimum < axis.maximum && axis.reduction > 0, "Invalid axis")
      axis
    }
    val presets = value("presets").arr.toVector.map(p => Preset(p("valid").bool, number(p("pan")), number(p("tilt"))))
    require(axes.size == 2 && presets.size == 8, "Invalid axes/presets")
    State(uint("epoch"), uint("seq"), value("result").str, value("armed").bool, value("referenced").bool,
      value("stopped").bool, value("moving").bool, axes, presets, value)

trait Transport extends AutoCloseable:
  def exchange(command: Option[ujson.Obj]): State
  def close(): Unit = ()

final class DeviceTransport(origin: URI, token: String) extends Transport:
  require(Set("http", "https").contains(origin.getScheme) && origin.getHost != null &&
    Option(origin.getRawPath).forall(p => p == "" || p == "/") && origin.getUserInfo == null &&
    origin.getQuery == null && origin.getFragment == null, "Use a device HTTP(S) origin without credentials or a path")
  require(token.matches("[\\x21-\\x7e]{16,128}"), "Token must be 16–128 printable characters")
  private val http = HttpClient.newBuilder().connectTimeout(Duration.ofMillis(1200)).followRedirects(HttpClient.Redirect.NEVER).build()
  def exchange(command: Option[ujson.Obj]): State =
    val request = HttpRequest.newBuilder(origin.resolve(if command.isDefined then "/api/command" else "/api/state"))
      .timeout(Duration.ofMillis(1800)).header("Authorization", s"Bearer $token")
    command match
      case Some(body) =>
        val json = ujson.write(body)
        require(json.length <= 768, "Command too large")
        request.header("Content-Type", "application/json").POST(HttpRequest.BodyPublishers.ofString(json))
      case None => request.GET()
    // Bound the complete response deadline, including a slow or incomplete body.
    val future = http.sendAsync(request.build(), _ => LimitedBody(16384))
    val response = try future.get(2200, java.util.concurrent.TimeUnit.MILLISECONDS)
      catch
        case error: Exception => future.cancel(true); throw error
    require(response.statusCode() != 401, "Authentication rejected")
    require(response.body().length <= 16384, "Oversized response")
    State.parse(ujson.read(response.body()))
  override def close(): Unit = http.shutdownNow()

/** All normal exchanges are serialized by Dashboard; STOP uses a separate generation. */
final class Session(val transport: Transport):
  @volatile private var generation = 0L
  @volatile private var current: Option[State] = None
  @volatile var owned = false
  def state: Option[State] = current
  def request(op: Option[String] = None, fields: Seq[(String, ujson.Value)] = Seq.empty): Option[State] =
    val (stamp, command) = synchronized {
      val body = op.map { name =>
        val s = current.getOrElse(throw IllegalStateException("Read state first"))
        require(!Set("move", "relative", "center", "preset_move").contains(name) || owned, "Arm this session before movement")
        require(s.seq < 4294967295L, "Sequence exhausted; STOP and reference again")
        ujson.Obj.from(fields ++ Seq("op" -> ujson.Str(name), "epoch" -> ujson.Num(s.epoch.toDouble), "seq" -> ujson.Num(s.seq.toDouble + 1)))
      }
      (generation, body)
    }
    val result = transport.exchange(command)
    synchronized {
      if generation != stamp then None
      else
        if current.exists(s => s.epoch != result.epoch || (op.isEmpty && s.seq != result.seq)) || result.result == "stale" || !result.armed || result.stopped then owned = false
        if op.contains("arm") && result.result == "ok" then owned = true
        current = Some(result)
        Some(result)
    }
  def stop(): Option[State] =
    val stamp = synchronized { generation += 1; owned = false; generation }
    val result = transport.exchange(Some(ujson.Obj("op" -> "stop")))
    synchronized {
      if stamp == generation then { current = Some(result); Some(result) } else None
    }
  def retire(): Unit = synchronized { generation += 1; owned = false }
  def close(): Unit =
    if owned then { val _ = Try(stop()) }
    retire()
    transport.close()
