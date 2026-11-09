package com.crewcue.android.crash

import android.content.Context
import com.crewcue.android.BuildConfig
import io.sentry.Breadcrumb
import io.sentry.SentryEvent
import io.sentry.android.core.SentryAndroid

/**
 * Sentry crash and error reporting (ADR 0010). Starts only in a release build whose
 * `BuildConfig.SENTRY_DSN` (from `-Pcrewcue.release.sentryDsn` in release.yml) is set.
 * Debug builds never start it. No user, screenshots, view hierarchy or tracing.
 */
object CrashReporting {
    @Volatile private var started = false

    fun shouldStart(debug: Boolean, dsn: String): Boolean = !debug && dsn.trim().startsWith("https://")

    fun start(context: Context) {
        if (started || !shouldStart(BuildConfig.DEBUG, BuildConfig.SENTRY_DSN)) return
        started = true
        SentryAndroid.init(context) { options ->
            options.dsn = BuildConfig.SENTRY_DSN.trim()
            options.isAttachScreenshot = false
            options.isAttachViewHierarchy = false
            options.tracesSampleRate = null
            options.isEnableUserInteractionBreadcrumbs = false
            options.setBeforeSend { event, _ -> scrub(event) }
            options.setBeforeBreadcrumb { crumb, _ -> scrub(crumb) }
        }
    }

    private fun scrub(event: SentryEvent): SentryEvent {
        event.user = null
        event.serverName = null
        event.message?.let { message ->
            message.formatted = CrashScrub.text(message.formatted)
            message.message = CrashScrub.text(message.message)
        }
        event.exceptions?.forEach { it.value = CrashScrub.text(it.value) }
        event.breadcrumbs = event.breadcrumbs?.map { scrub(it) }
        event.request?.let { request ->
            request.url = request.url?.let(CrashScrub::url)
            request.queryString = null
            request.cookies = null
            request.data = null
            request.headers = null
        }
        return event
    }

    private fun scrub(crumb: Breadcrumb): Breadcrumb {
        crumb.message = CrashScrub.text(crumb.message)
        val scrubbed = CrashScrub.map(crumb.data)
        crumb.data.clear()
        scrubbed.forEach { (key, value) -> if (value != null) crumb.setData(key, value) }
        return crumb
    }
}
