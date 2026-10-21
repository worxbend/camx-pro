package com.worxbend.camx

/** Deterministic, offline UI simulator; not a mechanical or timing qualification. Moves complete
  * instantly, so both axes of a diagonal arrive together as on firmware 1.1.0. */
final class Demo extends Transport:
  private val axes = ujson.Arr.from(Vector(4, 2).zipWithIndex.map { (ratio, i) =>
    ujson.Obj("degrees" -> 0, "target" -> 0, "steps" -> 0, "velocity" -> 0, "accel_now" -> 0,
      "motor_steps" -> 4096, "reduction" -> ratio, "minimum" -> (if i == 0 then -20 else -15),
      "maximum" -> (if i == 0 then 20 else 15), "speed" -> 4, "acceleration" -> 8, "jerk" -> 80,
      "inverted" -> false)
  })
  private def emptyPreset = ujson.Obj("valid" -> false, "pan" -> 0, "tilt" -> 0, "name" -> "")
  private val value = ujson.Obj("api" -> 1, "api_minor" -> 1, "result" -> "ok", "epoch" -> 100, "seq" -> 0,
    "armed" -> false, "referenced" -> false, "stopped" -> false, "moving" -> false, "jogging" -> false,
    "queued" -> false, "fault" -> "none", "commissioned" -> false, "storage_ok" -> true,
    "settings_dirty" -> false, "eta" -> 0, "motion" -> ujson.Obj("speed" -> 1, "accel" -> 1, "jerk" -> 1),
    "max_tick_gap_us" -> 0, "max_tick_cost_us" -> 0, "timing_faults" -> 0,
    "last_pose" -> ujson.Obj("valid" -> false, "pan" -> 0, "tilt" -> 0), "axes" -> axes,
    "presets" -> ujson.Arr.from(Vector.fill(8)(emptyPreset)))
  private def rotate(): Unit = { value("epoch") = value("epoch").num + 1; value("seq") = 0 }
  private def inRange(values: Seq[Double]): Boolean =
    values.zipWithIndex.forall((n, i) => n >= axes(i)("minimum").num && n <= axes(i)("maximum").num)
  private def scale(n: Double): Boolean = n >= 0.05 && n <= 1
  private def slot(c: ujson.Obj): Option[Int] =
    c.value.get("slot").map(_.num).filter(n => n.isWhole && n >= 0 && n < 8).map(_.toInt)
  private def name(c: ujson.Obj): Option[Option[String]] = c.value.get("name") match
    case None => Some(None)
    case Some(ujson.Str(text)) if State.validName(text) => Some(Some(text))
    case _ => None
  private def store(index: Int, pan: ujson.Value, tilt: ujson.Value, label: Option[String]): Unit =
    val old = value("presets")(index)
    val kept = if old("valid").bool then old("name").str else ""
    value("presets")(index) = ujson.Obj("valid" -> true, "pan" -> pan, "tilt" -> tilt, "name" -> label.getOrElse(kept))
  def exchange(command: Option[ujson.Obj]): State = synchronized {
    value("result") = "ok"
    command.foreach { c =>
      val op = c("op").str
      if op == "stop" then { value("stopped") = true; rotate() }
      else if c("epoch").num != value("epoch").num || c("seq").num <= value("seq").num then value("result") = "stale"
      else
        value("seq") = c("seq")
        op match
          case "reference" if !value("armed").bool =>
            if inRange(Vector(c("pan").num, c("tilt").num)) then
              value("referenced") = true; value("stopped") = false
              axes(0)("degrees") = c("pan"); axes(1)("degrees") = c("tilt"); rotate()
            else value("result") = "range"
          case "arm" if value("referenced").bool && !value("stopped").bool => value("armed") = true
          case "disarm" =>
            value("last_pose") = if value("referenced").bool then
              ujson.Obj("valid" -> true, "pan" -> axes(0)("degrees"), "tilt" -> axes(1)("degrees"))
            else ujson.Obj("valid" -> false, "pan" -> 0, "tilt" -> 0)
            value("armed") = false; value("referenced") = false; rotate()
          case "heartbeat" => ()
          case "motion" =>
            val keys = Vector("speed", "accel", "jerk").filter(c.value.contains)
            if keys.isEmpty then value("result") = "invalid"
            else if !keys.forall(k => scale(c(k).num)) then value("result") = "range"
            else keys.foreach(k => value("motion")(k) = c(k))
          case "preset_set" if !value("armed").bool =>
            (slot(c), name(c)) match
              case (Some(i), Some(label)) if inRange(Vector(c("pan").num, c("tilt").num)) => store(i, c("pan"), c("tilt"), label)
              case (Some(_), Some(_)) => value("result") = "range"
              case _ => value("result") = "invalid"
          case "preset_save" =>
            (slot(c), name(c)) match
              case (Some(i), Some(label)) =>
                if value("referenced").bool then store(i, axes(0)("degrees"), axes(1)("degrees"), label)
                else value("result") = "not_referenced"
              case _ => value("result") = "invalid"
          case "preset_clear" =>
            slot(c) match
              case Some(i) => value("presets")(i) = emptyPreset
              case None => value("result") = "invalid"
          case "settings" if !value("armed").bool =>
            for (key, field) <- Vector("speed" -> "speed", "accel" -> "acceleration", "jerk" -> "jerk") do
              c.value.get(s"pan_$key").foreach(v => axes.arr.foreach(a => a(field) = v))
            value("referenced") = false; rotate()
          case "move" | "relative" | "center" | "preset_move" if value("armed").bool && !value("stopped").bool =>
            val speed = c.value.get("speed").map(_.num).getOrElse(1.0)
            val target = Vector("pan", "tilt").zipWithIndex.map { (key, i) =>
              if op == "center" then 0.0
              else if op == "preset_move" then value("presets")(c("slot").num.toInt)(key).num
              else c(key).num + (if op == "relative" then axes(i)("degrees").num else 0.0)
            }
            if scale(speed) && inRange(target) then
              target.zipWithIndex.foreach { (n, i) => axes(i)("degrees") = n; axes(i)("target") = n }
            else value("result") = "range"
          case _ => value("result") = "busy"
    }
    State.parse(ujson.read(ujson.write(value)))
  }
