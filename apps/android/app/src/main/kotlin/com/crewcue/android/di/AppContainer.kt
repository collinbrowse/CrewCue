package com.crewcue.android.di

import com.crewcue.android.ClientCoreBridge
import com.crewcue.android.logging.AndroidLogger

class AppContainer {
    val logger = AndroidLogger()

    fun featureScreenJson(url: String): String {
        logger.log(url)
        return ClientCoreBridge.featureScreenJsonForUrl(url)
    }
}
