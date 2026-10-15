package com.crewcue.android.ui.notifications

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import com.crewcue.android.ui.theme.PrimaryButton
import com.crewcue.android.ui.theme.ProductCard
import com.crewcue.android.ui.theme.ProductTitle

@Composable
fun NotificationPermissionScreen() {
    val context = LocalContext.current
    var status by remember { mutableStateOf(notificationStatus(context)) }
    var working by remember { mutableStateOf(false) }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        working = false
        status = if (granted) "Notifications are on." else "Notification permission was denied."
    }
    Column(
        Modifier
            .fillMaxSize()
            .testTag("crewcue.onboarding-notifications")
            .semantics { contentDescription = "Notifications" }
            .padding(20.dp)
    ) {
        ProductTitle("Notifications", "Allow alerts so crew messages reach this phone.")
        ProductCard(Modifier.padding(top = 16.dp)) {
            Text(status, modifier = Modifier.semantics { contentDescription = status })
            PrimaryButton(
                "Allow notifications",
                onClick = {
                    if (notificationsAllowed(context)) {
                        status = "Notifications are on."
                    } else {
                        working = true
                        launcher.launch(Manifest.permission.POST_NOTIFICATIONS)
                    }
                },
                modifier = Modifier.padding(top = 12.dp),
                enabled = !working
            )
        }
    }
}

private fun notificationStatus(context: Context): String {
    return if (notificationsAllowed(context)) "Notifications are on." else "Notifications are off."
}

private fun notificationsAllowed(context: Context): Boolean {
    if (Build.VERSION.SDK_INT < 33) return true
    return ContextCompat.checkSelfPermission(
        context,
        Manifest.permission.POST_NOTIFICATIONS
    ) == PackageManager.PERMISSION_GRANTED
}
