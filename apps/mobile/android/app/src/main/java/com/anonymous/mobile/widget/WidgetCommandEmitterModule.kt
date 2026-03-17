package com.anonymous.mobile.widget

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.modules.core.DeviceEventManagerModule

class WidgetCommandEmitterModule(
  private val reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {

  companion object {
    private var instance: WidgetCommandEmitterModule? = null

    fun sendCommand(action: String, payload: Map<String, Any?> = emptyMap()) {
      instance?.emit(action, payload)
    }
  }

  init {
    instance = this
  }

  override fun getName(): String = "WidgetCommandEmitter"

  private fun emit(action: String, payload: Map<String, Any?>) {
    val body = Arguments.createMap()
    body.putString("action", action)

    val payloadMap = Arguments.createMap()
    payload.forEach { (key, value) ->
      when (value) {
        is String -> payloadMap.putString(key, value)
        is Boolean -> payloadMap.putBoolean(key, value)
        is Int -> payloadMap.putInt(key, value)
        is Double -> payloadMap.putDouble(key, value)
        null -> payloadMap.putNull(key)
        else -> payloadMap.putString(key, value.toString())
      }
    }
    body.putMap("payload", payloadMap)

    reactContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit("widgetCommand", body)
  }
}
