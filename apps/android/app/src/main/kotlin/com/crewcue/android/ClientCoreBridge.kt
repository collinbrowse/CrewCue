package com.crewcue.android

import com.crewcue.clientcore.CrewCueClientCore

/**
 * Compose calls the swift-java JNI facade. Screen copy comes from the Swift package as JSON.
 */
object ClientCoreBridge {
    fun helloStamp(): String = CrewCueClientCore.helloStamp()

    fun featureScreenJsonForUrl(url: String): String = CrewCueClientCore.featureScreenJsonForUrl(url)
}
