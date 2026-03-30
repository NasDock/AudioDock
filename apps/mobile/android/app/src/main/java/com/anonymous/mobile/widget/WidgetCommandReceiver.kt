package com.anonymous.mobile.widget

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class WidgetCommandReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val action = intent.action ?: return
    val state = WidgetStore.load(context)

    when (action) {
      ACTION_WIDGET_MODE -> {
        val nextMode = nextPlayMode(state.playMode)
        WidgetStore.save(
          context,
          state.title,
          state.artist,
          state.coverPath,
          state.isPlaying,
          nextMode,
          state.isLiked,
          state.isVip,
          state.colorPrimary,
          state.colorSecondary,
          state.position,
          state.duration
        )
        WidgetStore.setPlayModeOverride(context, nextMode)
        AudioDockWidgetProvider.updateAllWidgets(context)
        WidgetCommandEmitterModule.sendCommand(
          "mode",
          mapOf("playMode" to state.playMode, "nextPlayMode" to nextMode)
        )
      }
      ACTION_WIDGET_LIKE -> {
        WidgetStore.save(
          context,
          state.title,
          state.artist,
          state.coverPath,
          state.isPlaying,
          state.playMode,
          true,
          state.isVip,
          state.colorPrimary,
          state.colorSecondary,
          state.position,
          state.duration
        )
        WidgetStore.setLikedOverride(context, true)
        AudioDockWidgetProvider.updateAllWidgets(context)
        WidgetCommandEmitterModule.sendCommand("like")
      }
      ACTION_WIDGET_UNLIKE -> {
        WidgetStore.save(
          context,
          state.title,
          state.artist,
          state.coverPath,
          state.isPlaying,
          state.playMode,
          false,
          state.isVip,
          state.colorPrimary,
          state.colorSecondary,
          state.position,
          state.duration
        )
        WidgetStore.setLikedOverride(context, false)
        AudioDockWidgetProvider.updateAllWidgets(context)
        WidgetCommandEmitterModule.sendCommand("unlike")
      }
      ACTION_WIDGET_PLAYLIST -> {
        val id = intent.getStringExtra("id") ?: ""
        if (id.isNotEmpty()) {
          WidgetCommandEmitterModule.sendCommand("play_playlist", mapOf("id" to id))
        }
      }
      ACTION_WIDGET_HISTORY -> {
        val id = intent.getStringExtra("id") ?: ""
        if (id.isNotEmpty()) {
          WidgetCommandEmitterModule.sendCommand("play_history", mapOf("id" to id))
        }
      }
      ACTION_WIDGET_LATEST -> {
        val id = intent.getStringExtra("id") ?: ""
        if (id.isNotEmpty()) {
          WidgetCommandEmitterModule.sendCommand("play_latest", mapOf("id" to id))
        }
      }
      ACTION_WIDGET_RECOMMENDATION -> {
        val id = intent.getStringExtra("id") ?: ""
        if (id.isNotEmpty()) {
          WidgetCommandEmitterModule.sendCommand("play_recommendation", mapOf("id" to id))
        }
      }
      ACTION_WIDGET_REFRESH_LATEST -> {
        WidgetCommandEmitterModule.sendCommand("refresh_latest")
      }
    }
  }

  private fun nextPlayMode(raw: String): String {
    val normalized = normalizePlayMode(raw)
    val modes = listOf("SEQUENCE", "SHUFFLE", "LOOP_LIST", "LOOP_SINGLE")
    val index = modes.indexOf(normalized)
    return if (index == -1) modes[0] else modes[(index + 1) % modes.size]
  }

  private fun normalizePlayMode(raw: String): String {
    return when (raw.uppercase()) {
      "SHUFFLE", "RANDOM" -> "SHUFFLE"
      "LOOP_SINGLE", "SINGLE_LOOP", "SINGLE" -> "LOOP_SINGLE"
      "LOOP_LIST", "LIST_LOOP", "LOOP" -> "LOOP_LIST"
      "SEQUENCE", "ORDER", "DEFAULT" -> "SEQUENCE"
      else -> raw
    }
  }

  companion object {
    const val ACTION_WIDGET_MODE = "com.soundx.widget.MODE"
    const val ACTION_WIDGET_LIKE = "com.soundx.widget.LIKE"
    const val ACTION_WIDGET_UNLIKE = "com.soundx.widget.UNLIKE"
    const val ACTION_WIDGET_PLAYLIST = "com.soundx.widget.PLAYLIST"
    const val ACTION_WIDGET_HISTORY = "com.soundx.widget.HISTORY"
    const val ACTION_WIDGET_LATEST = "com.soundx.widget.LATEST"
    const val ACTION_WIDGET_RECOMMENDATION = "com.soundx.widget.RECOMMENDATION"
    const val ACTION_WIDGET_REFRESH_LATEST = "com.soundx.widget.REFRESH_LATEST"
  }
}
