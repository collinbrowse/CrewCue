package com.crewcue.android

import androidx.test.ext.junit.runners.AndroidJUnit4
import com.crewcue.android.data.optText
import com.crewcue.android.ui.members.MemberPermissions
import com.crewcue.android.ui.pace.PaceViewModel
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/** Screen rules that must match the API and the behavior checklists. */
@RunWith(AndroidJUnit4::class)
class ScreenRulesTest {
    @Test
    fun onlyTheAthleteMayRemoveMembers() {
        assertTrue(MemberPermissions.mayRemoveMembers("ada", "ada"))
        assertFalse(MemberPermissions.mayRemoveMembers("ben", "ada"))
        assertFalse(MemberPermissions.mayRemoveMembers(null, "ada"))
        assertFalse(MemberPermissions.mayRemoveMembers("ada", null))
        assertTrue(MemberPermissions.mayRemove("ada", "ada", "ben"))
        assertFalse(MemberPermissions.mayRemove("ada", "ada", "ada"))
        assertFalse(MemberPermissions.mayRemove("ben", "ada", "carl"))
        assertFalse(MemberPermissions.mayRemove("ada", "ada", null))
    }

    @Test
    fun crewSeeAHistoryBackedEstimateWithoutLoadingHistory() {
        val summary = "History-backed pace\nFinish 4:51:59  14:03 UTC"
        // Crew never load history, so usableHistoryCount is 0 for them.
        assertEquals(summary to null, PaceViewModel.estimateCopy(true, false, 0, summary))
        assertEquals(PaceViewModel.COLD_START to summary, PaceViewModel.estimateCopy(true, true, 0, summary))
        assertEquals(PaceViewModel.COLD_START to null, PaceViewModel.estimateCopy(false, false, 0, null))
        assertEquals(PaceViewModel.ESTIMATE_EMPTY to null, PaceViewModel.estimateCopy(false, false, 2, null))
    }

    @Test
    fun jsonNullTextIsBlank() {
        val row = JSONObject("""{"displayName":null,"name":"Ada"}""")
        assertEquals("", row.optText("displayName"))
        assertEquals("", row.optText("missing"))
        assertEquals("Ada", row.optText("name"))
    }
}
