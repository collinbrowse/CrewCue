package com.crewcue.android.ui.onboarding

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.crewcue.android.ui.CrewTabBar
import com.crewcue.android.ui.FeatureScreen
import com.crewcue.android.ui.ShellTab
import com.crewcue.android.ui.ShellViewModel
import com.crewcue.android.ui.UiState

/**
 * `crewcue://dev/onboarding-runner-tour` and `crewcue://dev/onboarding-crew`: the tour's cards
 * over a fixture tab bar on the example race, with no account and no API. Every button moves on
 * and nothing is saved or sent, except that Turn on notifications shows the system prompt. The
 * runner's tour ends on Map with the setup checklist, played the same way.
 */
@Composable
fun TourDevRoute(shell: ShellViewModel, role: String) {
    val context = LocalContext.current
    val tour: OnboardingTourViewModel = viewModel(
        key = "tour-dev-$role",
        factory = OnboardingTourViewModel.factory(shell.container.raceDay, context, devRole = role)
    )
    var tabName by rememberSaveable { mutableStateOf(if (role == "crew") ShellTab.Map.name else ShellTab.Profile.name) }
    val tab = ShellTab.valueOf(tabName)
    val anchors = remember { TourAnchors() }
    LaunchedEffect(tour) { tour.refresh() }
    // Done on the last card: the checklist waits on Map.
    val tourOver = tour.card == null && tour.checklist != null
    LaunchedEffect(tourOver) { if (tourOver) tabName = ShellTab.Map.name }
    Box(Modifier.fillMaxSize()) {
        Column(
            Modifier
                .fillMaxSize()
                .statusBarsPadding()
                .padding(bottom = 96.dp)
        ) {
            val checklist = tour.checklist?.takeIf { tour.card == null && tab == ShellTab.Map }
            if (checklist != null) {
                SetupChecklistPanel(
                    checklist = checklist,
                    onOpen = { row ->
                        when (row.opens) {
                            "inviteShare" -> tabName = ShellTab.Profile.name
                            "paceStopEdit" -> tabName = ShellTab.Pace.name
                        }
                        tour.openChecklistItem(row.kind)
                    },
                    onHide = tour::hideChecklist,
                    maxHeight = LocalConfiguration.current.screenHeightDp.dp * 0.4f,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)
                )
            }
            // Read once per tab: a fixture's copy is a client-core call, not something to repeat per frame.
            val screen = remember(tab) { shell.fixtureScreen(tab.url) }
            FeatureScreen(UiState.Success(screen), Modifier.weight(1f))
        }
        CrewTabBar(
            selected = tab,
            chatUnread = 0,
            onSelect = { tabName = it.name },
            anchors = anchors,
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .navigationBarsPadding()
                .padding(horizontal = 16.dp, vertical = 8.dp)
        )
        TourOverlayHost(
            tour = tour,
            anchors = anchors,
            onSelectTab = { tabName = it.name },
            onStartLine = { tabName = ShellTab.Map.name }
        )
    }
}
