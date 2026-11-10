package com.crewcue.android.ui.settings

import org.junit.Assert.assertEquals
import org.junit.Test

class AccountDeletionTest {
    @Test
    fun onlyAServerConfirmedDeleteSignsOut() {
        assertEquals(DeletionOutcome.Deleted, deletionOutcome(deleted = true, message = null, failure = null, offline = false))
    }

    @Test
    fun clientCoreFailureMessageIsShownAndTheUserStaysSignedIn() {
        val msg = "Your data was deleted, but we couldn't finish removing your login. Try again."
        assertEquals(DeletionOutcome.Failed(msg), deletionOutcome(deleted = false, message = msg, failure = null, offline = false))
    }

    @Test
    fun bridgeFailureMapsToOfflineOrGenericRetry() {
        assertEquals(DeletionOutcome.Failed(DELETION_OFFLINE), deletionOutcome(null, null, failure = "x", offline = true))
        assertEquals(DeletionOutcome.Failed(DELETION_FAILED), deletionOutcome(null, null, failure = "x", offline = false))
        assertEquals(DeletionOutcome.Failed(DELETION_FAILED), deletionOutcome(deleted = false, message = null, failure = null, offline = false))
    }
}
