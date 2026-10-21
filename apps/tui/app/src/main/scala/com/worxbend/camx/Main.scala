package com.worxbend.camx
import java.net.URI
import scala.util.control.NonFatal

object Main:
  val help = """CAMX Pro / Glyphora remote
Usage: ./mill app.run --demo [--json]
       ./mill app.run --url http://DEVICE_IP [--json]

Live mode prompts for the API token, or reads CAMX_API_TOKEN from the environment.
--json reads state once without arming or moving. No automatic reconnect/arm.
Alt+arrows: bounded steps; Alt+y/u/b/n: diagonal steps. Esc: STOP.
q: quit (best-effort STOP if owned). Firmware 1.1.0 adds motion feel, retargeting,
named presets and the last-pose hint; with 1.0.0 they are hidden.
Reference: enter actual pan/tilt, choose Reference, physically align, Ctrl+r.
The demo is synthetic and never connects to hardware.
"""
  def main(args: Array[String]): Unit =
    if args.contains("--help") then println(help)
    else
      try
        val options = args.toList
        val demo = options.contains("--demo")
        val json = options.contains("--json")
        val rest = options.filterNot(Set("--demo", "--json"))
        require((demo && rest.isEmpty) || (!demo && rest.size == 2 && rest.head == "--url"), help)
        val transport: Transport = if demo then Demo() else
          val token = sys.env.get("CAMX_API_TOKEN").getOrElse {
            require(System.console() != null, "Set CAMX_API_TOKEN for a noninteractive launch")
            val chars = System.console().readPassword("API token: ")
            require(chars != null, "Token input cancelled")
            try String(chars) finally java.util.Arrays.fill(chars, '\u0000')
          }
          DeviceTransport(URI.create(rest(1)), token)
        if json then
          try println(ujson.write(transport.exchange(None).raw, indent = 2))
          finally transport.close()
        else
          val session = Session(transport)
          try
            val app = Dashboard(session, demo)
            app.run() match
              case Left(error) => System.err.println(error); System.exit(1)
              case Right(_) => ()
          finally session.close()
      catch
        case NonFatal(_) =>
          System.err.println("Unable to start/read the controller. Check --help, device URL, token, terminal and connectivity.")
          System.exit(1)
