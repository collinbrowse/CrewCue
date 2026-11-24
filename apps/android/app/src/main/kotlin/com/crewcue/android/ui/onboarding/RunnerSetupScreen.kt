package com.crewcue.android.ui.onboarding

import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.adaptive.ExperimentalMaterial3AdaptiveApi
import androidx.compose.material3.adaptive.Posture
import androidx.compose.material3.adaptive.currentWindowAdaptiveInfo
import androidx.compose.material3.adaptive.layout.AdaptStrategy
import androidx.compose.material3.adaptive.layout.AnimatedPane
import androidx.compose.material3.adaptive.layout.HingePolicy
import androidx.compose.material3.adaptive.layout.PaneAdaptedValue
import androidx.compose.material3.adaptive.layout.SupportingPaneScaffold
import androidx.compose.material3.adaptive.layout.SupportingPaneScaffoldDefaults
import androidx.compose.material3.adaptive.layout.SupportingPaneScaffoldRole
import androidx.compose.material3.adaptive.layout.calculatePaneScaffoldDirectiveWithTwoPanesOnMediumWidth
import androidx.compose.material3.adaptive.navigation.rememberSupportingPaneScaffoldNavigator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInWindow
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import androidx.lifecycle.createSavedStateHandle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.crewcue.android.R
import com.crewcue.android.ui.ShellViewModel
import com.crewcue.android.ui.findActivity
import com.crewcue.android.ui.map.isOnline
import com.crewcue.android.ui.theme.CrewTextField
import com.crewcue.android.ui.theme.Kicker
import com.crewcue.android.ui.theme.MetricLargeStyle
import java.time.LocalDate
import java.time.ZoneId
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * The onboarding route (`onboarding-runner-setup`): client-core's onboarding state picks what
 * shows. Loading (never the chooser before the race list is known), the chooser, or the runner's
 * phase 1 setup. Every other state belongs to the shell, which routes away from here.
 */
@Composable
fun OnboardingScreen(shell: ShellViewModel) {
    val text = shell.onboardingText
    val flow = shell.onboarding
    Box(
        Modifier
            .fillMaxSize()
            .testTag(SETUP_TAG)
            .semantics { contentDescription = shell.uiState.screen.title }
    ) {
        when (OnboardingRouting.content(flow, openedByLink = shell.setupFromLink)) {
            OnboardingContent.Chooser -> OnboardingChooser(shell, text)
            OnboardingContent.RunnerSetup -> if (flow != null) RunnerSetup(shell, flow, text)
            OnboardingContent.Loading -> SetupLoading(shell, text)
        }
    }
}

@Composable
private fun SetupLoading(shell: ShellViewModel, text: OnboardingText) {
    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(24.dp)
            .navigationBarsPadding(),
        verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        SetupLoader(setupTag("loading"))
        // The race list couldn't load and nothing saved decides yet: say so, and offer a retry.
        if (shell.racesFailed && shell.session != null && !shell.racesLoading) {
            val line = if (shell.racesFailedOffline) text.setupOffline else text.setupError
            Text(
                line,
                modifier = Modifier.testTag(setupTag("loading.failure")).semantics { contentDescription = line },
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            SetupSecondaryButton(text.label("tryAgain"), setupTag("retry"), onClick = { shell.loadRaces() })
        }
    }
}

/** "I'm running a race" or "I'm crewing for someone". */
@Composable
private fun OnboardingChooser(shell: ShellViewModel, text: OnboardingText) {
    AdaptiveSetupLayout(
        form = { inline ->
            FormColumn(setupTag("chooser")) {
                if (inline) Illustration()
                StepHeader(text.label("chooserTitle"), "")
                SetupPrimaryButton(text.chooserRunner, setupTag("chooser.runner"), { shell.chooseOnboarding("runner") })
                SetupSecondaryButton(text.chooserCrew, setupTag("chooser.crew"), { shell.chooseOnboarding("crew") })
                if (shell.session == null) {
                    SetupSecondaryButton(text.label("chooserSignIn"), setupTag("chooser.sign-in"), shell::openSignedOut)
                }
            }
        },
        preview = { Illustration() }
    )
}

@Composable
private fun RunnerSetup(shell: ShellViewModel, flow: OnboardingFlow, text: OnboardingText) {
    val session = shell.session
    val userId = session?.userId
    val model: RunnerSetupViewModel = viewModel(
        key = "runner-setup-${userId ?: "guest"}",
        factory = viewModelFactory {
            initializer {
                RunnerSetupViewModel(
                    runtime = BridgeRunnerSetupRuntime(shell.container.raceDay, shell::onboardingRaceContext),
                    drafts = shell.container.runnerSetupDrafts,
                    savedState = createSavedStateHandle(),
                    userId = userId,
                    sessionName = session?.displayName,
                    text = text,
                    deviceZone = ZoneId.systemDefault().id,
                    today = LocalDate.now(),
                    initialFlow = flow
                )
            }
        }
    )
    // Each fresh race list too: the race's name, course and start, and the relaunch check.
    val races = shell.onboardingRaces
    LaunchedEffect(model, flow, races) { model.sync(flow, races.rows, races.version) }
    LaunchedEffect(model) { model.effects.collect(shell::onSetupEffect) }
    // client-core's answers for the step (RunnerSetupViewModel.rules), asked off Main: the loader
    // until the first one comes back (a frame or so on open), or while the state names no step.
    val step = model.step
    if (step == null) {
        SetupLoading(shell, text)
        return
    }
    // System Back and the predictive back gesture do what the arrow does. Taken whenever the arrow
    // shows; while a step saves (RunnerSetupViewModel.goBack) or Auth0 is open for the account
    // step it does nothing, so it never closes the app or leaves mid-request.
    val authWorking = session == null && shell.signInConnection != null
    val back = { if (!authWorking) model.goBack() }
    BackHandler(enabled = model.showsBack, onBack = back)
    Column(Modifier.fillMaxSize()) {
        if (model.showsBack) SetupTopBar(text.back, enabled = !model.busy && !authWorking, onBack = back)
        Box(Modifier.weight(1f).fillMaxWidth()) {
            AdaptiveSetupLayout(
                form = { inlinePreview -> StepForm(shell, model, step, text, inlinePreview) },
                preview = { LivePreview(model, step, text) }
            )
        }
    }
    // Above the layout, so a fold or resize that changes the panes never closes a picker or
    // loses a half-made pick: which one is open lives in the ViewModel.
    if (step == SetupSteps.START_TIME) StartTimeDialogs(model, text)
}

/**
 * The standard top app bar with only the navigation arrow, over the page's own ground: the step
 * before this one, or from the first step the chooser (only while no race exists).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SetupTopBar(label: String, enabled: Boolean, onBack: () -> Unit) {
    TopAppBar(
        title = {},
        navigationIcon = {
            IconButton(onClick = onBack, enabled = enabled, modifier = Modifier.testTag(BACK_TAG)) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = label)
            }
        },
        // The route already sits below the status bar (FeatureHost).
        windowInsets = WindowInsets(0),
        colors = TopAppBarDefaults.topAppBarColors(containerColor = Color.Transparent)
    )
}

/**
 * One layout at every size, so folding, unfolding or resizing keeps the form where it is in the
 * composition: its scroll position, fields and pickers stay, and the panes animate. Compact: one
 * step per screen, the form and then its preview in one scroll ([form] draws both when told to).
 * Medium and expanded: the step beside a live preview (`SupportingPaneScaffold`, kept off any
 * vertical hinge). Tabletop: one pane, the preview above the fold and the controls below it.
 */
@OptIn(ExperimentalMaterial3AdaptiveApi::class)
@Composable
private fun AdaptiveSetupLayout(form: @Composable (inlinePreview: Boolean) -> Unit, preview: @Composable () -> Unit) {
    val info = currentWindowAdaptiveInfo()
    val tabletop = info.windowPosture.isTabletop
    val panes = calculatePaneScaffoldDirectiveWithTwoPanesOnMediumWidth(info, HingePolicy.AlwaysAvoid)
    // Compact gets one pane from the directive; tabletop asks for one and splits it at the fold.
    val directive = if (tabletop) panes.copy(maxHorizontalPartitions = 1) else panes
    // With one pane the preview hides (the form draws it below itself, or tabletop puts it above
    // the fold), never the scaffold's default reflow, which splits a tall phone into two halves.
    val navigator = rememberSupportingPaneScaffoldNavigator(
        scaffoldDirective = directive,
        adaptStrategies = SupportingPaneScaffoldDefaults.adaptStrategies(supportingPaneAdaptStrategy = AdaptStrategy.Hide)
    )
    val besidePreview = navigator.scaffoldValue[SupportingPaneScaffoldRole.Supporting] != PaneAdaptedValue.Hidden
    SupportingPaneScaffold(
        directive = navigator.scaffoldDirective,
        value = navigator.scaffoldValue,
        mainPane = {
            AnimatedPane(Modifier.testTag(setupTag("pane.form"))) {
                FoldSplit(
                    posture = info.windowPosture.takeIf { tabletop },
                    top = preview,
                    bottom = { form(!besidePreview && !tabletop) }
                )
            }
        },
        supportingPane = { AnimatedPane(Modifier.testTag(setupTag("pane.preview"))) { preview() } }
    )
}

/**
 * Half-open with the hinge across ([posture] set): content on the top half, controls on the bottom,
 * nothing on the hinge. Flat ([posture] null): [bottom] fills the pane. [bottom] is always the
 * first child, so opening or flattening the device only moves it and its state stays.
 */
@Composable
internal fun FoldSplit(posture: Posture?, top: @Composable () -> Unit, bottom: @Composable () -> Unit) {
    var rootTop by remember { mutableFloatStateOf(0f) }
    val density = LocalDensity.current
    val hinge = posture?.hingeList?.firstOrNull { !it.isVertical }
    Box(
        Modifier
            .fillMaxSize()
            .onGloballyPositioned { rootTop = it.positionInWindow().y }
    ) {
        val below = when {
            posture == null -> Modifier.fillMaxSize()
            hinge == null -> Modifier.fillMaxWidth().fillMaxHeight(0.5f).align(Alignment.BottomCenter)
            else -> Modifier.fillMaxSize().padding(top = with(density) { (hinge.bounds.bottom - rootTop).coerceAtLeast(0f).toDp() })
        }
        Box(below) { bottom() }
        if (posture != null) {
            val above = if (hinge == null) {
                Modifier.fillMaxWidth().fillMaxHeight(0.5f)
            } else {
                Modifier.fillMaxWidth().height(with(density) { (hinge.bounds.top - rootTop).coerceAtLeast(0f).toDp() })
            }
            Box(above.align(Alignment.TopCenter).testTag(setupTag("tabletop"))) { top() }
        }
    }
}

@Composable
private fun FormColumn(tag: String, content: @Composable () -> Unit) {
    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .imePadding()
            .navigationBarsPadding()
            .padding(horizontal = 24.dp, vertical = 16.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Column(
            Modifier
                .widthIn(max = 560.dp)
                .fillMaxWidth()
                .testTag(tag)
                .animateContentSize(),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            content()
        }
    }
}

@Composable
private fun StepForm(shell: ShellViewModel, model: RunnerSetupViewModel, step: String, text: OnboardingText, inlinePreview: Boolean) {
    AnimatedContent(
        targetState = step,
        transitionSpec = { fadeIn() togetherWith fadeOut() },
        label = "setup-step"
    ) { shown ->
        FormColumn(setupTag("step.$shown")) {
            StepHeader(
                text.title(shown),
                if (shown == SetupSteps.TEASER) text.setupSuccess else text.explanation(shown)
            )
            when (shown) {
                SetupSteps.ACCOUNT -> AccountStep(shell, model, text)
                SetupSteps.COURSE -> CourseStep(model, text)
                SetupSteps.START_TIME -> StartTimeStep(model, text)
                SetupSteps.HISTORY -> HistoryStep(model, text)
                SetupSteps.TEASER -> TeaserStep(model, text)
            }
            // Right under the step's buttons, before any preview, so it shows without scrolling.
            // The course step's Try again waits for the race's name, like Choose course file.
            val context = LocalContext.current
            StatusLine(
                model.status,
                text,
                onRetry = { model.retry(context.isOnline()) },
                retryEnabled = model.canRetry,
                onCancel = if (model.canCancelCourse) model::cancelPendingCourse else null
            )
            // Compact: the course below the form, in the same scroll.
            if (inlinePreview) InlineCoursePreview(model, text)
        }
    }
}

@Composable
private fun AccountStep(shell: ShellViewModel, model: RunnerSetupViewModel, text: OnboardingText) {
    val activity = LocalContext.current.findActivity()
    if (shell.session == null) {
        val working = shell.signInConnection != null
        SetupPrimaryButton(
            text.label("createAccount"),
            setupTag("account.sign-up"),
            { shell.signIn(activity, connection = null, signUp = true) },
            busy = working
        )
        SetupSecondaryButton(text.label("signIn"), setupTag("account.sign-in"), { shell.signIn(activity) }, enabled = !working)
    } else {
        // "Your name", with what it is for under it. It never starts with the email (client-core
        // `SuggestedDisplayName`, read when the draft is made).
        CrewTextField(
            model.draft.displayName,
            model::updateName,
            text.label("displayName"),
            Modifier.testTag(DISPLAY_NAME_TAG),
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Words, imeAction = ImeAction.Done),
            supportingText = text.label("displayNameHelp").ifBlank { null }
        )
        SetupPrimaryButton(
            text.label("continueStep"),
            setupTag("account.continue"),
            model::saveAccount,
            enabled = model.draft.displayName.isNotBlank(),
            busy = model.busy
        )
    }
    shell.setupAuthFailure?.let { line ->
        Text(
            line,
            modifier = Modifier.testTag(setupTag("account.failure")).semantics { contentDescription = line },
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.error
        )
    }
}

/**
 * The system file picker for a course file; the picked file goes to [RunnerSetupViewModel.chooseCourse].
 * GPX has no registered MIME type on most devices, so it opens on any file and the server checks
 * the content.
 */
@Composable
private fun rememberCoursePicker(model: RunnerSetupViewModel): () -> Unit {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            val (name, xml) = withContext(Dispatchers.IO) { readCourseFile(context, uri) }
            model.chooseCourse(name, xml, context.isOnline())
        }
    }
    return { picker.launch(arrayOf("*/*")) }
}

/**
 * The race's name first (the course file creates the race with it), then the course file. The
 * main button follows client-core `RunnerSetupSteps.courseContinue`: Choose course file, Continue
 * on a previewed file, or "Course saved" and Continue on a phone that doesn't hold the race's file.
 * After a failed preview the step's Try again (under it) reads the same file again.
 */
@Composable
private fun CourseStep(model: RunnerSetupViewModel, text: OnboardingText) {
    val context = LocalContext.current
    val choose = rememberCoursePicker(model)
    RaceNameField(model, text)
    val fileName = model.shownCourseFileName
    when {
        model.showsCourseSaved -> CourseSavedLine(text.label("courseSaved"), model.savedCourseFileName)
        fileName != null -> Text(
            fileName,
            modifier = Modifier.testTag(setupTag("course.file")),
            style = MaterialTheme.typography.titleMedium,
            color = MaterialTheme.colorScheme.onSurface
        )
        else -> Text(text.setupEmpty, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
    val action = model.courseAction
    when {
        // Try again (and Cancel, for a file picked after Back) sit under the step, with the error.
        model.courseNeedsRetry -> Unit
        action == CourseContinue.ChooseFile ->
            SetupPrimaryButton(
                text.label("chooseCourseFile"),
                setupTag("course.choose"),
                choose,
                enabled = model.canChooseCourse,
                busy = model.busy
            )
        else ->
            SetupPrimaryButton(
                text.label("continueStep"),
                setupTag("course.continue"),
                { model.continueCourse(context.isOnline()) },
                enabled = model.canContinueCourse,
                busy = model.busy
            )
    }
    if (model.courseNeedsRetry || action != CourseContinue.ChooseFile) {
        SetupSecondaryButton(text.label("chooseAnotherFile"), setupTag("course.choose-another"), choose, enabled = model.canChooseCourse)
    }
}

/**
 * The race's name: a field until the race exists (kept in the draft as it is typed), then the
 * name read-only, because the API has no rename.
 */
@Composable
private fun RaceNameField(model: RunnerSetupViewModel, text: OnboardingText) {
    val label = text.label("raceName")
    if (model.raceNameLocked) {
        val name = model.shownRaceName ?: return
        Column(
            Modifier
                .fillMaxWidth()
                .testTag(RACE_NAME_TAG)
                .semantics(mergeDescendants = true) {},
            verticalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(name, style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSurface)
        }
    } else {
        CrewTextField(
            model.draft.raceName.orEmpty(),
            model::updateRaceName,
            label,
            Modifier.testTag(RACE_NAME_TAG),
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Words, imeAction = ImeAction.Done),
            placeholder = text.label("raceNamePlaceholder").ifBlank { null },
            supportingText = text.label("raceNameHelp").ifBlank { null }
        )
    }
}

/** "Course saved", with the file's name when this phone knows it: nothing is uploaded again. */
@Composable
private fun CourseSavedLine(label: String, fileName: String?) {
    val spoken = listOfNotNull(label, fileName).joinToString(", ")
    Row(
        Modifier
            .fillMaxWidth()
            .testTag(COURSE_SAVED_TAG)
            .clearAndSetSemantics { contentDescription = spoken },
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(Icons.Outlined.CheckCircle, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(label, style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSurface)
            fileName?.let {
                Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable
private fun StartTimeStep(model: RunnerSetupViewModel, text: OnboardingText) {
    val context = LocalContext.current
    val start = model.start
    FieldButton(text.label("raceDate"), model.startDateLabel, setupTag("start.date")) { model.openDialog(RunnerSetupViewModel.DIALOG_DATE) }
    FieldButton(text.label("raceTime"), model.startTimeLabel, setupTag("start.time")) { model.openDialog(RunnerSetupViewModel.DIALOG_TIME) }
    FieldButton(text.label("raceTimeZone"), start.timeZone.replace('_', ' '), setupTag("start.zone")) {
        model.openDialog(RunnerSetupViewModel.DIALOG_ZONE)
    }
    model.startProblem?.let { problem ->
        Text(
            problem,
            modifier = Modifier.testTag(setupTag("start.problem")).semantics { contentDescription = problem },
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.error
        )
    }
    // The course goes with the start and this phone lost its file: pick it again here.
    if (model.startNeedsCourseFile) {
        val choose = rememberCoursePicker(model)
        Text(text.setupEmpty, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        SetupPrimaryButton(text.label("chooseCourseFile"), setupTag("start.choose-course"), choose, enabled = model.canChooseCourse, busy = model.busy)
        return
    }
    // Continue moves on, or saves only what changed (client-core `RunnerSetupSteps.startTimeContinue`).
    SetupPrimaryButton(
        text.label("continueStep"),
        setupTag("start.continue"),
        { model.continueStart(context.isOnline()) },
        enabled = model.canContinueStart,
        busy = model.busy
    )
}

/** The date, time and zone pickers, whichever the ViewModel has open. */
@Composable
private fun StartTimeDialogs(model: RunnerSetupViewModel, text: OnboardingText) {
    val start = model.start
    val deviceZone = remember { ZoneId.systemDefault().id }
    when (model.dialog) {
        RunnerSetupViewModel.DIALOG_DATE -> RaceDateDialog(start, text, model::updateStart, model::closeDialog)
        RunnerSetupViewModel.DIALOG_TIME -> RaceTimeDialog(start, text, model::updateStart, model::closeDialog)
        RunnerSetupViewModel.DIALOG_ZONE ->
            RaceZoneDialog(start, deviceZone, text, model.zoneFilter, model::updateZoneFilter, model::updateStart, model::closeDialog)
    }
}

@Composable
private fun HistoryStep(model: RunnerSetupViewModel, text: OnboardingText) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            val (name, content) = withContext(Dispatchers.IO) { readHistoryFile(context, uri) }
            model.importHistory(name, content, context.isOnline())
        }
    }
    HistoryTips(text.historyTips)
    model.historyMessage?.let { line ->
        Text(
            line,
            modifier = Modifier.testTag(setupTag("history.message")).semantics { contentDescription = line },
            style = MaterialTheme.typography.bodyLarge
        )
    }
    // Hidden when client-core answers null: history changed nothing the runner can see.
    model.comparison?.let { line ->
        Text(
            line,
            modifier = Modifier.testTag(setupTag("history.comparison")).semantics { contentDescription = line },
            style = MaterialTheme.typography.titleMedium,
            color = MaterialTheme.colorScheme.primary
        )
    }
    // FIT and TCX have no registered MIME type on most devices; the server checks the content.
    val choose = { picker.launch(arrayOf("*/*")) }
    // Continue after an import on this visit, and always on a history step already passed (its
    // estimate still holds); Skip always attaches the rough estimate.
    if (model.historyShowsContinue) {
        SetupPrimaryButton(text.label("continueStep"), setupTag("history.continue"), model::finishHistory, busy = model.busy)
        SetupSecondaryButton(text.label("importHistory"), setupTag("history.import"), choose, enabled = !model.busy)
    } else {
        SetupPrimaryButton(text.label("importHistory"), setupTag("history.import"), choose, busy = model.busy)
    }
    SetupSecondaryButton(text.label("skipHistory"), setupTag("history.skip"), model::skipHistory, enabled = !model.busy)
}

/** Under the lead (the step's explanation): which run to pick, the formats, and that it is optional. */
@Composable
private fun HistoryTips(tips: List<String>) {
    if (tips.isEmpty()) return
    Column(
        Modifier.fillMaxWidth().testTag(HISTORY_TIPS_TAG),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        tips.forEach { tip ->
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("•", style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.primary)
                Text(tip, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurface)
            }
        }
    }
}

@Composable
private fun TeaserStep(model: RunnerSetupViewModel, text: OnboardingText) {
    val teaser = model.teaser
    if (teaser == null) {
        if (model.busy) SetupLoader(setupTag("teaser.loading"))
        return
    }
    // client-core's clock, the one its summary and the history comparison write too, in the
    // race's zone (the start's), named under the finish when it isn't this phone's.
    val finish = teaser.finishClock ?: "—"
    val zone = model.teaserZoneLabel
    Column(
        Modifier.testTag(setupTag("teaser.finish")).semantics(mergeDescendants = true) {
            contentDescription = listOfNotNull("${text.label("finish")} $finish", zone).joinToString(", ")
        }
    ) {
        Kicker(text.label("finish"))
        Text(finish, style = MetricLargeStyle, color = MaterialTheme.colorScheme.primary)
        zone?.let {
            Text(
                it,
                modifier = Modifier.testTag(setupTag("teaser.zone")),
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
        teaser.summary?.let {
            Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
    Column(Modifier.testTag(setupTag("teaser.timeline")), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        teaser.rows.forEach { row -> TeaserRowCard(row, text) }
    }
    SetupPrimaryButton(text.label("continueStep"), setupTag("teaser.continue"), model::finishTeaser, busy = model.busy)
}

/**
 * Compact's preview, below the form: the course on the map with its elevation (from the route).
 * The rest of the two-pane preview (start, finish, comparison) is already in the form.
 */
@Composable
private fun InlineCoursePreview(model: RunnerSetupViewModel, text: OnboardingText) {
    val course = model.preview?.takeIf { !it.isEmpty }
    if (course == null && !model.courseLoading) return
    Column(Modifier.padding(top = 8.dp).testTag(setupTag("preview.inline")), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Kicker(text.label("coursePreview"))
        CoursePreviewSlot(course, model.courseLoading, model.courseLoadingCaption, text, onRendered = model::noteCourseMapReady)
    }
}

/** The supporting pane: the course on the map with its elevation, and what the runner picked so far. */
@Composable
private fun LivePreview(model: RunnerSetupViewModel, step: String, text: OnboardingText) {
    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .navigationBarsPadding()
            .padding(horizontal = 24.dp, vertical = 16.dp)
            .testTag(setupTag("preview"))
            .animateContentSize(),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        Kicker(text.label("coursePreview"))
        val course = model.preview?.takeIf { !it.isEmpty }
        if (course == null && !model.courseLoading) {
            Illustration()
        } else {
            CoursePreviewSlot(course, model.courseLoading, model.courseLoadingCaption, text, onRendered = model::noteCourseMapReady)
        }
        if (step == SetupSteps.START_TIME || step == SetupSteps.HISTORY) {
            val start = model.start
            Text(
                listOf(model.startDateLabel, model.startTimeLabel, start.timeZone.replace('_', ' '))
                    .filter { it.isNotBlank() }
                    .joinToString(" · "),
                modifier = Modifier.testTag(setupTag("preview.start")),
                style = MaterialTheme.typography.titleMedium
            )
        }
        model.teaser?.finishClock?.let { finish ->
            Column(Modifier.testTag(setupTag("preview.finish"))) {
                Kicker(text.label("finish"))
                Text(finish, style = MetricLargeStyle, color = MaterialTheme.colorScheme.primary)
                model.teaserZoneLabel?.let {
                    Text(it, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
        model.comparison?.let { Text(it, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.primary) }
    }
}

@Composable
private fun Illustration() {
    Box(Modifier.fillMaxWidth().padding(16.dp), contentAlignment = Alignment.Center) {
        Image(
            painter = painterResource(R.drawable.onboarding_runner),
            contentDescription = null,
            modifier = Modifier.fillMaxWidth().heightIn(max = 240.dp),
            contentScale = ContentScale.Fit
        )
    }
}
