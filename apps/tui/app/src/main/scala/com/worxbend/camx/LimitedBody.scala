package com.worxbend.camx

import java.io.ByteArrayOutputStream
import java.net.http.HttpResponse.BodySubscriber
import java.nio.ByteBuffer
import java.util.concurrent.{CompletableFuture, CompletionStage, Flow}

/** Refuse oversized responses before buffering them; the request owns the deadline. */
private[camx] final class LimitedBody(limit: Int) extends BodySubscriber[String]:
  private val result = CompletableFuture[String]()
  private val bytes = ByteArrayOutputStream()
  private var subscription: Option[Flow.Subscription] = None
  def getBody(): CompletionStage[String] = result
  def onSubscribe(value: Flow.Subscription): Unit =
    if subscription.isDefined then value.cancel()
    else { subscription = Some(value); value.request(1) }
  def onNext(buffers: java.util.List[ByteBuffer]): Unit =
    val iterator = buffers.iterator()
    while iterator.hasNext && !result.isDone do
      val buffer = iterator.next()
      if buffer.remaining() > limit - bytes.size() then
        subscription.foreach(_.cancel())
        val _ = result.completeExceptionally(IllegalArgumentException("Oversized response"))
      else
        val chunk = Array.ofDim[Byte](buffer.remaining())
        buffer.get(chunk)
        bytes.write(chunk)
    if !result.isDone then subscription.foreach(_.request(1))
  def onError(error: Throwable): Unit = { val _ = result.completeExceptionally(error) }
  def onComplete(): Unit = { val _ = result.complete(bytes.toString(java.nio.charset.StandardCharsets.UTF_8)) }
