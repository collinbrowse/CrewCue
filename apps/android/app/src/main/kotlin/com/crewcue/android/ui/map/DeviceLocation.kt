package com.crewcue.android.ui.map

import android.annotation.SuppressLint
import android.content.Context
import android.location.Location
import android.location.LocationManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import android.os.Looper

fun Context.isOnline(): Boolean {
    val manager = getSystemService(ConnectivityManager::class.java) ?: return true
    val network = manager.activeNetwork ?: return false
    val capabilities = manager.getNetworkCapabilities(network) ?: return false
    return capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
}

fun String.looksOffline(): Boolean {
    val lower = lowercase()
    return lower.contains("offline") ||
        lower.contains("network") ||
        lower.contains("internet") ||
        lower.contains("unable to resolve") ||
        lower.contains("failed to connect") ||
        lower.contains("timeout") ||
        lower.contains("timed out")
}

@SuppressLint("MissingPermission")
fun requestLocationSample(context: Context, onSample: (Location) -> Unit, onMissing: () -> Unit) {
    val manager = context.getSystemService(LocationManager::class.java)
    if (manager == null) {
        onMissing()
        return
    }
    val provider = when {
        runCatching { manager.isProviderEnabled(LocationManager.GPS_PROVIDER) }.getOrDefault(false) ->
            LocationManager.GPS_PROVIDER
        runCatching { manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER) }.getOrDefault(false) ->
            LocationManager.NETWORK_PROVIDER
        else -> null
    }
    val last = listOfNotNull(provider, LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)
        .distinct()
        .firstNotNullOfOrNull { name -> runCatching { manager.getLastKnownLocation(name) }.getOrNull() }
    if (provider == null) {
        if (last != null) onSample(last) else onMissing()
        return
    }
    if (last != null && System.currentTimeMillis() - last.time < 120_000) {
        onSample(last)
        return
    }
    try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            manager.getCurrentLocation(provider, null, context.mainExecutor) { location ->
                when {
                    location != null -> onSample(location)
                    last != null -> onSample(last)
                    else -> onMissing()
                }
            }
        } else {
            @Suppress("DEPRECATION")
            manager.requestSingleUpdate(provider, { location ->
                onSample(location)
            }, Looper.getMainLooper())
        }
    } catch (_: SecurityException) {
        onMissing()
    }
}
