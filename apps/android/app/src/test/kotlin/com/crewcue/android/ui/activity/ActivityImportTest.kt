package com.crewcue.android.ui.activity

import com.crewcue.android.BuildConfig
import com.crewcue.android.data.RuntimeResult
import com.crewcue.android.nav.DevRoutes
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test

class ActivityImportTest {
    @Test
    fun stravaIsOffAndHasNoDevRoute() {
        assertFalse(BuildConfig.STRAVA_ENABLED)
        assertNull(DevRoutes.featureId("crewcue://dev/strava"))
    }

    @Test
    fun activityImportHasADevRoute() {
        assertEquals("activity-import", DevRoutes.featureId("crewcue://dev/activity-import?state=error"))
    }

    @Test
    fun bridgeFailuresMapToChecklistCopy() {
        assertEquals(ACTIVITY_IMPORT_OFFLINE, ActivityImportViewModel.messageFor(RuntimeResult.Failure("x", offline = true)))
        assertEquals(ACTIVITY_IMPORT_ERROR, ActivityImportViewModel.messageFor(RuntimeResult.Failure("x", offline = false)))
    }
}
