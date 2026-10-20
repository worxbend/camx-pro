package com.worxbend.camx

/** Deterministic, offline UI simulator; not a mechanical or timing qualification. */
final class Demo extends Transport:
  private val axes = ujson.Arr.from(Vector(4, 2).zipWithIndex.map { (ratio, i) =>
    ujson.Obj("degrees" -> 0, "target" -> 0, "steps" -> 0, "velocity" -> 0, "motor_steps" -> 4096,
      "reduction" -> ratio, "minimum" -> (if i == 0 then -20 else -15), "maximum" -> (if i == 0 then 20 else 15),
      "speed" -> 4, "acceleration" -> 8, "inverted" -> false)
  })
  private val value = ujson.Obj("api" -> 1, "result" -> "ok", "epoch" -> 100, "seq" -> 0,
    "armed" -> false, "referenced" -> false, "stopped" -> false, "moving" -> false, "jogging" -> false,
    "fault" -> "none", "commissioned" -> false, "storage_ok" -> true, "settings_dirty" -> false,
    "max_tick_gap_us" -> 0, "timing_faults" -> 0, "axes" -> axes,
    "presets" -> ujson.Arr.from(Vector.fill(8)(ujson.Obj("valid" -> false, "pan" -> 0, "tilt" -> 0))))
  private def rotate(): Unit = { value("epoch") = value("epoch").num + 1; value("seq") = 0 }
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
            if Vector("pan", "tilt").zipWithIndex.forall((key, i) => c(key).num >= axes(i)("minimum").num && c(key).num <= axes(i)("maximum").num) then
              value("referenced") = true; value("stopped") = false
              axes(0)("degrees") = c("pan"); axes(1)("degrees") = c("tilt"); rotate()
            else value("result") = "range"
          case "arm" if value("referenced").bool && !value("stopped").bool => value("armed") = true
          case "disarm" => value("armed") = false; value("referenced") = false; rotate()
          case "heartbeat" => ()
          case "preset_set" if !value("armed").bool => value("presets")(c("slot").num.toInt) = ujson.Obj("valid" -> true, "pan" -> c("pan"), "tilt" -> c("tilt"))
          case "settings" if !value("armed").bool =>
            axes.arr.foreach(a => { a("speed") = c("pan_speed"); a("acceleration") = c("pan_accel") })
            value("referenced") = false; rotate()
          case "move" | "relative" | "center" | "preset_move" if value("armed").bool && !value("stopped").bool =>
            val target = Vector("pan", "tilt").zipWithIndex.map { (key, i) =>
              if op == "center" then 0.0
              else if op == "preset_move" then value("presets")(c("slot").num.toInt)(key).num
              else c(key).num + (if op == "relative" then axes(i)("degrees").num else 0.0)
            }
            if target.zipWithIndex.forall((n, i) => n >= axes(i)("minimum").num && n <= axes(i)("maximum").num) then
              target.zipWithIndex.foreach { (n, i) => axes(i)("degrees") = n; axes(i)("target") = n }
            else value("result") = "range"
          case _ => value("result") = "busy"
    }
    State.parse(ujson.read(ujson.write(value)))
  }
