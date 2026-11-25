package com.crewcue.android.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.crewcue.android.ui.profile.RaceRow
import com.crewcue.android.ui.theme.PillButton
import com.crewcue.android.ui.theme.ToolSheet

/**
 * After the active race is deleted: the person's other races, then Create new race and Join race
 * room. Nothing is picked for them; closing it leaves no race active.
 */
@Composable
fun RaceChooserSheet(viewModel: ShellViewModel) {
    ToolSheet("Race deleted", onDismiss = viewModel::dismissRaceChooser) {
        RaceChoices(
            races = viewModel.races,
            onSelect = viewModel::selectRace,
            onCreate = viewModel::chooseCreateRace,
            onJoin = viewModel::chooseJoinRace,
            modifier = Modifier.testTag("crewcue.race-chooser")
        )
    }
}

/** The races to switch to, then the two ways to get a new one. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun RaceChoices(
    races: List<RaceChoice>,
    onSelect: (String) -> Unit,
    onCreate: () -> Unit,
    onJoin: () -> Unit,
    modifier: Modifier = Modifier
) {
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(
            if (races.isEmpty()) {
                "Create a race for your run, or join your crew's race with an invite code."
            } else {
                "Pick the race Map, Pace and Chat should follow, or start a new one."
            },
            style = MaterialTheme.typography.bodyLarge
        )
        if (races.isNotEmpty()) {
            Column(Modifier.testTag("crewcue.race-choices")) {
                races.forEach { race -> RaceRow(race, active = false, onSelect = { onSelect(race.id) }) }
            }
        }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            PillButton("Create new race", onClick = onCreate, prominent = true)
            PillButton("Join race room", onClick = onJoin)
        }
    }
}
