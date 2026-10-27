package com.crewcue.android

import android.content.Intent
import android.net.Uri
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.crewcue.android.session.SessionStore
import org.json.JSONObject
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Opens every feature deeplink in `clients/behavior/deeplinks.json` and asserts its test tag.
 * Runs regardless of checklist status: a row is `pass` only with device proof, but every screen must still open.
 */
@RunWith(AndroidJUnit4::class)
class DeeplinkSmokeTest {
    @get:Rule
    val compose = createEmptyComposeRule()

    @Test
    fun everyDeeplinkShowsItsScreen() {
        val context = InstrumentationRegistry.getInstrumentation().context
        val manifest = context.assets.open("deeplinks.json").bufferedReader().use { JSONObject(it.readText()) }
        val features = manifest.getJSONArray("features")
        val target = InstrumentationRegistry.getInstrumentation().targetContext
        // A session left on the device would open the product shell instead of the screen under test.
        SessionStore(target).clear()
        val missing = mutableListOf<String>()
        for (index in 0 until features.length()) {
            val feature = features.getJSONObject(index)
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(feature.getString("entry")))
                .setClass(target, MainActivity::class.java)
            // Signed out, the shell entry shows sign-in instead of the shell.
            val label = if (feature.getString("id") == "app-shell") "crewcue.auth-signed-out" else feature.getString("label")
            ActivityScenario.launch<MainActivity>(intent).use {
                // Collect every miss so one run reports all broken screens, not just the first.
                runCatching {
                    compose.onNodeWithTag(label, useUnmergedTree = true).assertExists()
                }.onFailure {
                    missing += "${feature.getString("id")}: $label missing for ${feature.getString("entry")}"
                }
            }
        }
        check(features.length() > 0) { "deeplinks.json lists no features" }
        check(missing.isEmpty()) { missing.joinToString("\n") }
    }
}
