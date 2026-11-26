package com.crewcue.android.ui.pace

import org.json.JSONObject
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PaceRecalculateTest {
    @Test
    fun theRunnerSeesRecalculateThoughTheirPhoneAlsoRecomputes() {
        assertTrue(mayShowRecalculate(JSONObject("""{"mayRecalculate":true,"mayAutoRecompute":true}""")))
    }

    @Test
    fun crewSeeRecalculateAndAnUnknownRoleDoesNot() {
        assertTrue(mayShowRecalculate(JSONObject("""{"mayRecalculate":true,"mayAutoRecompute":false}""")))
        assertFalse(mayShowRecalculate(JSONObject("""{"mayRecalculate":false,"mayAutoRecompute":false}""")))
        assertFalse(mayShowRecalculate(JSONObject("{}")))
    }
}
