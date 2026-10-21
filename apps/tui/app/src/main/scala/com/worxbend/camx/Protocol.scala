package com.worxbend.camx

import java.net.URI
import java.net.http.{HttpClient, HttpRequest}
import java.time.Duration
import scala.util.Try

final case class Axis(degrees: Double, minimum: Double, maximum: Double, speed: Double, reduction: Double,
    jerk: Option[Double] = None)
final case class Preset(valid: Boolean, pan: Double, tilt: Double, name: String = "")
final case class Pose(pan: Double, tilt: Double)
/** Runtime multipliers of the configured speed, acceleration and jerk (firmware 1.1.0). */
final case class Scales(speed: Double, accel: Double, jerk: Double)
final case class State(epoch: Long, seq: Long, result: String, armed: Boolean, referenced: Boolean,
    stopped: Boolean, moving: Boolean, axes: Vector[Axis], presets: Vector[Preset], raw: ujson.Value,
    apiMinor: Int = 0, jogging: Boolean = false, queued: Boolean = false, eta: Double = 0,
    scales: Option[Scales] = None, lastPose: Option[Pose] = None, dirty: Boolean = false):
  /** Firmware 1.1.0 adds motion scales, per-move speed, retargeting, named presets, saving the
    * present pose, clearing presets, the last-pose hint and the jerk setting. */
  def extended: Boolean = apiMinor >= 1
object State:
  // Printable ASCII without '"' and '\\', as the firmware accepts them.
  private val printable = "[\\x20\\x21\\x23-\\x5b\\x5d-\\x7e]{0,16}"
  def validName(name: String): Boolean = name.matches(printable)
  def parse(value: ujson.Value): State =
    require(value("api").num == 1, "Unsupported API")
    val fields = value.obj
    def uint(name: String): Long =
      val number = value(name).num
      require(number.isWhole && number >= 0 && number <= 4294967295L, "Invalid session counter")
      number.toLong
    def number(v: ujson.Value): Double =
      val n = v.num
      require(n.isFinite, "Invalid numeric value")
      n
    val apiMinor = if fields.contains("api_minor") then uint("api_minor").toInt else 0
    val extended = apiMinor >= 1
    val axes = value("axes").arr.toVector.map { a =>
      val jerk = if extended then Some(number(a("jerk"))) else None
      val axis = Axis(number(a("degrees")), number(a("minimum")), number(a("maximum")), number(a("speed")), number(a("reduction")), jerk)
      require(axis.minimum < axis.maximum && axis.reduction > 0 && jerk.forall(_ > 0), "Invalid axis")
      axis
    }
    val presets = value("presets").arr.toVector.map { p =>
      val name = if extended then p("name").str else ""
      require(validName(name), "Invalid preset name")
      Preset(p("valid").bool, number(p("pan")), number(p("tilt")), name)
    }
    require(axes.size == 2 && presets.size == 8, "Invalid axes/presets")
    def scale(n: Double): Double = { require(n >= 0.05 && n <= 1, "Invalid motion scale"); n }
    val scales = Option.when(extended) {
      val m = value("motion")
      Scales(scale(number(m("speed"))), scale(number(m("accel"))), scale(number(m("jerk"))))
    }
    val lastPose = if !extended then None else
      val pose = value("last_pose")
      val (pan, tilt) = (number(pose("pan")), number(pose("tilt")))
      Option.when(pose("valid").bool)(Pose(pan, tilt))
    val eta = if extended then number(value("eta")) else 0.0
    require(eta >= 0, "Invalid ETA")
    State(uint("epoch"), uint("seq"), value("result").str, value("armed").bool, value("referenced").bool,
      value("stopped").bool, value("moving").bool, axes, presets, value, apiMinor,
      fields.get("jogging").exists(_.bool), extended && value("queued").bool, eta, scales, lastPose,
      fields.get("settings_dirty").exists(_.bool))

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
