package com.crewcue.android.invite

import com.crewcue.android.data.RuntimeResult
import com.crewcue.android.nav.DevRoutes
import com.crewcue.android.nav.InboundLink
import com.crewcue.android.ui.invite.InviteShare
import com.crewcue.android.ui.invite.InviteState
import com.crewcue.android.ui.invite.InviteText
import com.crewcue.android.ui.join.JoinResult
import com.crewcue.android.ui.join.JoinTone
import com.crewcue.android.ui.join.PendingInvite
import com.crewcue.android.ui.join.joiningLine
import java.io.File
import kotlinx.coroutines.test.runTest
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class InviteLinksTest {
    /** Stands in for client-core's `InviteLink` parser, which the JVM can't load. */
    private val parsed = mutableListOf<String>()
    private val parser: (String) -> String? = { url ->
        parsed += url
        when (url) {
            "https://collinbrowse.github.io/crewcue/join/?code=123456" -> "123456"
            "crewcue://join/234567" -> "234567"
            else -> null
        }
    }

    @Test
    fun joinLinksOpenInEveryBuildAndFixturesOnlyInDebug() {
        for (enabled in listOf(true, false)) {
            assertEquals(
                InboundLink.Join("123456"),
                DevRoutes.inbound("https://collinbrowse.github.io/crewcue/join/?code=123456", enabled, parser)
            )
            assertEquals(InboundLink.Join("234567"), DevRoutes.inbound("crewcue://join/234567", enabled, parser))
        }
        assertEquals(InboundLink.Feature("join-crew"), DevRoutes.inbound("crewcue://dev/join-crew", enabled = true, inviteCode = parser))
        // Release builds open no fixture route from a link.
        assertNull(DevRoutes.inbound("crewcue://dev/join-crew", enabled = false, inviteCode = parser))
        // Not ours: another site, a bad code, nothing.
        assertNull(DevRoutes.inbound("https://example.com/crewcue/join/?code=123456", enabled = true, inviteCode = parser))
        assertNull(DevRoutes.inbound("crewcue://join/12", enabled = false, inviteCode = parser))
        assertNull(DevRoutes.inbound(null, enabled = true, inviteCode = parser))
        assertNull(DevRoutes.inbound(" ", enabled = true, inviteCode = parser))
    }

    @Test
    fun fixtureRoutesNeverGoToTheInviteParser() {
        parsed.clear()
        DevRoutes.inbound("crewcue://dev/room-members", enabled = true, inviteCode = parser)
        DevRoutes.inbound("crewcue://strava?code=1", enabled = true, inviteCode = parser)
        assertTrue(parsed.isEmpty())
    }

    @Test
    fun theManifestOpensTheJoinPageClientCoreBuilds() {
        // Unit tests run from apps/android/app. The host lives once in client-core; the manifest
        // must name the same host and path for App Links to verify.
        val source = File("../../../packages/client-core/Sources/CrewCueClientCore/InviteLink.swift").readText()
        val page = Regex("""joinPage = "https://([^/"]+)(/[^"]*)"""").find(source)
        val (host, path) = page!!.destructured
        val manifest = File("src/main/AndroidManifest.xml").readText()
        val filter = manifest.substringAfter("""<intent-filter android:autoVerify="true">""").substringBefore("</intent-filter>")
        assertTrue(filter.contains("""android:scheme="https""""))
        assertTrue(filter.contains("""android:host="$host""""))
        assertTrue(filter.contains("""android:pathPrefix="${path.trimEnd('/')}""""))
        assertEquals("collinbrowse.github.io", host)
        assertEquals("/crewcue/join/", path)
    }

    @Test
    fun theReferrerIsReadOnceOnTheFirstLaunchPlayAnswers() = runTest {
        val once = MemoryOnce()
        var reads = 0
        var answer: ReferrerRead = ReferrerRead.TryLater
        val check = InstallReferrerCheck({ reads++; answer }, once)
        // Play couldn't answer: nothing, and the next launch asks again.
        assertNull(check.firstReferrer())
        assertFalse(once.done)
        answer = ReferrerRead.Answered("utm_source=google-play&crewcue_join=123456")
        assertEquals("utm_source=google-play&crewcue_join=123456", check.firstReferrer())
        assertTrue(once.done)
        // Never again, whatever Play would say.
        assertNull(check.firstReferrer())
        assertEquals(2, reads)
    }

    @Test
    fun aReferrerPlayCanNeverGiveEndsTheCheck() = runTest {
        val unsupported = MemoryOnce()
        assertNull(InstallReferrerCheck({ ReferrerRead.Unsupported }, unsupported).firstReferrer())
        assertTrue(unsupported.done)
        val blank = MemoryOnce()
        assertNull(InstallReferrerCheck({ ReferrerRead.Answered("  ") }, blank).firstReferrer())
        assertTrue(blank.done)
        val thrown = MemoryOnce()
        assertNull(InstallReferrerCheck({ error("binder died") }, thrown).firstReferrer())
        assertFalse(thrown.done)
        val faked = MemoryOnce()
        assertEquals("crewcue_join=345678", InstallReferrerCheck(FakeInstallReferrer("crewcue_join=345678"), faked).firstReferrer())
    }

    @Test
    fun pendingInviteReadsClientCoresRecord() {
        val saved = RuntimeResult.Success(JSONObject("""{"pendingJoin":{"code":"123456","source":"link","savedAt":"x","expiresAt":"y"}}"""))
        assertEquals(PendingInvite("123456", "link"), PendingInvite.from(saved))
        assertNull(PendingInvite.from(RuntimeResult.Success(JSONObject("""{"pendingJoin":null}"""))))
        assertNull(PendingInvite.from(RuntimeResult.Failure("Enter the 6-digit invite code.", offline = false)))
        assertEquals("typed", PendingInvite.from(RuntimeResult.Success(JSONObject("""{"pendingJoin":{"code":"123456"}}""")))?.source)
    }

    @Test
    fun joinOutcomesMapToTheSessionAndTheScreen() {
        fun outcome(json: String) = JoinResult.from(RuntimeResult.Success(JSONObject(json)))
        val joined = outcome("""{"outcome":"joined","roomId":"r1","message":null,"clearsCode":true}""")
        assertEquals("r1", joined.roomId)
        assertEquals("crew_member", joined.role)
        assertNull(joined.message)
        assertEquals(JoinTone.Success, joined.tone)
        assertNull(joined.next)
        // A newer link opened while the join was out is still pending: its screen comes next.
        val newer = outcome("""{"outcome":"joined","roomId":"r1","message":null,"pendingJoin":{"code":"654321","source":"link"}}""")
        assertEquals(PendingInvite("654321", "link"), newer.next)

        val already = outcome("""{"outcome":"alreadyMember","roomId":"r1","message":"You're already in this race."}""")
        assertEquals("r1", already.roomId)
        // The runner rejoining their own race: the race list brings the role.
        assertEquals("", already.role)
        assertEquals("You're already in this race.", already.message)

        val full = outcome("""{"outcome":"raceFull","roomId":null,"message":"This race is full. Ask the runner to upgrade their pass."}""")
        assertNull(full.roomId)
        assertFalse(full.joined)
        assertEquals("This race is full. Ask the runner to upgrade their pass.", full.message)
        assertEquals(JoinTone.Error, full.tone)

        val offline = outcome("""{"outcome":"offline","roomId":null,"message":"Offline. Joining a race needs the network."}""")
        assertEquals(JoinTone.Offline, offline.tone)

        val bare = outcome("""{"outcome":"nothingPending","roomId":null,"message":null}""")
        assertEquals(JoinResult.FAILED, bare.message)

        val down = JoinResult.from(RuntimeResult.Failure("The Internet connection appears to be offline.", offline = true))
        assertEquals(JoinTone.Offline, down.tone)
        assertEquals(JoinResult.OFFLINE, down.message)
        assertEquals(JoinTone.Error, JoinResult.from(RuntimeResult.Failure("Request failed", offline = false)).tone)
    }

    @Test
    fun thePreviewLineIsClientCoresElseTheRaceName() {
        assertEquals(
            "You're joining Ana's race: Leadville.",
            joiningLine(JSONObject("""{"roomName":"Leadville","joiningLine":"You're joining Ana's race: Leadville."}"""))
        )
        assertEquals("Leadville", joiningLine(JSONObject("""{"roomName":"Leadville","joiningLine":null}""")))
        assertNull(joiningLine(JSONObject("""{"roomName":" "}""")))
    }

    @Test
    fun theShareCardReadsClientCoresInvite() {
        val json = JSONObject(
            """{"state":"ready","status":"Crew can join once you unlock this race.","details":{"raceName":"Leadville 100","code":"123456","link":"https://collinbrowse.github.io/crewcue/join/?code=123456","shareText":"Join my crew","locked":true},"copy":{"shareTitle":"Invite your crew","shareButton":"Share invite","shareEmpty":"No invite code for this race yet."}}"""
        )
        val share = InviteShare.from(json)
        assertTrue(share.shareable)
        assertEquals("123456", share.code)
        assertEquals("Join my crew", share.text)
        assertTrue(share.locked)
        assertEquals("Crew can join once you unlock this race.", share.status)
        val text = InviteText.from(json.optJSONObject("copy"))
        assertEquals("Share invite", text.shareButton)
        assertEquals("No invite code for this race yet.", text.shareEmpty)
        // A line client-core didn't send reads empty, never "null".
        assertEquals("", text.pasteLabel)
        assertEquals("", InviteText.from(null).shareTitle)
        val empty = InviteShare.from(JSONObject("""{"state":"empty","status":"No invite code for this race yet.","details":null}"""))
        assertEquals(InviteState.Empty, empty.state)
        assertFalse(empty.shareable)
        assertEquals(InviteState.Offline, InviteShare.from(JSONObject("""{"state":"offline","status":"o"}""")).state)
        // The bridge itself failed: an error, with the line the screen passes.
        val failed = InviteShare.from(null, "Couldn't load the invite.")
        assertEquals(InviteState.Error, failed.state)
        assertEquals("Couldn't load the invite.", failed.status)
        assertFalse(failed.shareable)
    }

    @Test
    fun aJoinLinkWithoutACodeStillOpensTheJoinScreen() {
        val joinLink: (String) -> Boolean = { it.startsWith("crewcue://join") || it.startsWith("https://collinbrowse.github.io/crewcue/join") }
        for (enabled in listOf(true, false)) {
            assertEquals(InboundLink.JoinWithoutCode, DevRoutes.inbound("crewcue://join/12", enabled, parser, joinLink))
            assertEquals(
                InboundLink.JoinWithoutCode,
                DevRoutes.inbound("https://collinbrowse.github.io/crewcue/join/", enabled, parser, joinLink)
            )
        }
        assertEquals(InboundLink.Join("234567"), DevRoutes.inbound("crewcue://join/234567", false, parser, joinLink))
        assertNull(DevRoutes.inbound("https://example.com/", true, parser, joinLink))
    }

    @Test
    fun theInviteDevRoutesAreClientCoresIds() {
        assertEquals("invite-share", DevRoutes.featureId("crewcue://dev/invite-share"))
        assertEquals("join-link", DevRoutes.featureId("crewcue://dev/join-link?state=empty"))
        // The checklist rows open these routes in the device smoke tests.
        val index = JSONObject(File("../../../clients/behavior/deeplinks.json").readText()).getJSONArray("features")
        val rows = (0 until index.length()).map { index.getJSONObject(it) }.associateBy { it.getString("id") }
        for (id in listOf("invite-share", "join-link")) {
            assertEquals("crewcue://dev/$id", rows.getValue(id).getString("entry"))
            assertEquals(id, DevRoutes.featureId(rows.getValue(id).getString("entry")))
            assertEquals("crewcue.$id", rows.getValue(id).getString("label"))
        }
    }

    private class MemoryOnce : ReferrerOnce {
        var done = false
        override fun isDone() = done
        override fun markDone() {
            done = true
        }
    }
}
