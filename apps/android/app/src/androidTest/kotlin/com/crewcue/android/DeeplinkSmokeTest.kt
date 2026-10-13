package com.crewcue.android

import android.content.Intent
import android.net.Uri
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** Opens every deeplink that `clients/behavior/deeplinks.json` marks as passing on Android and asserts its test tag. */
@RunWith(AndroidJUnit4::class)
class DeeplinkSmokeTest {
    @get:Rule
    val compose = createEmptyComposeRule()

    @Test
    fun everyPassingDeeplinkShowsItsScreen() {
        val context = InstrumentationRegistry.getInstrumentation().context
        val manifest = context.assets.open("deeplinks.json").bufferedReader().use { JSONObject(it.readText()) }
        val features = manifest.getJSONArray("features")
        val target = InstrumentationRegistry.getInstrumentation().targetContext
        var checked = 0
        for (index in 0 until features.length()) {
            val feature = features.getJSONObject(index)
            if (feature.getString("android") != "pass") continue
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(feature.getString("entry")))
                .setClass(target, MainActivity::class.java)
            ActivityScenario.launch<MainActivity>(intent).use {
                compose.onNodeWithTag(feature.getString("label"), useUnmergedTree = true).assertExists(
                    "${feature.getString("id")}: ${feature.getString("label")} missing for ${feature.getString("entry")}"
                )
            }
            checked++
        }
        check(checked > 0) { "deeplinks.json has no Android-passing features" }
    }
}
