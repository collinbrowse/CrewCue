package com.crewcue.android.generated

data class AccountDeletionResult(
    val deleted: Boolean,
    val roomsClosed: Double,
    val membershipsRemoved: Double,
    val activityHistoryDeleted: Double,
    val pacingEstimatesDeleted: Double,
    val finishedEffortsDeleted: Double,
    val pushDevicesDeleted: Double,
    val chatPrefsDeleted: Double,
    val stravaDisconnected: Boolean,
    val identityProvider: String
)
