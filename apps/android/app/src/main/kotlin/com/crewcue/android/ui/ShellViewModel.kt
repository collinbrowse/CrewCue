package com.crewcue.android.ui

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import com.crewcue.android.di.AppContainer
import org.json.JSONObject

data class UserFacingError(
    val code: String,
    val message: String,
    val retryable: Boolean
)

data class ScreenCopy(
    val featureId: String,
    val accessibilityIdentifier: String,
    val title: String,
    val body: String
)

sealed interface UiState {
    val screen: ScreenCopy

    data class Success(override val screen: ScreenCopy) : UiState
    data class Empty(override val screen: ScreenCopy) : UiState
    data class Error(override val screen: ScreenCopy, val failure: UserFacingError) : UiState
    data class Offline(override val screen: ScreenCopy, val failure: UserFacingError) : UiState

    companion object {
        fun from(screen: ScreenCopy, state: String): UiState = when (state) {
            "empty" -> Empty(screen)
            "error" -> Error(
                screen,
                UserFacingError(code = "error", message = screen.body, retryable = false)
            )
            "offline" -> Offline(
                screen,
                UserFacingError(code = "offline", message = screen.body, retryable = true)
            )
            else -> Success(screen)
        }
    }
}

class ShellViewModel(
    private val container: AppContainer,
    initialUrl: String?
) : ViewModel() {
    var uiState by mutableStateOf<UiState>(UiState.Success(placeholder))
        private set
    var showAppShell by mutableStateOf(false)
        private set
    var routeId by mutableStateOf("app-shell")
        private set

    init {
        open(initialUrl)
    }

    fun open(url: String?) {
        showAppShell = url == null || url.endsWith("dev/app-shell")
        val fetchUrl = if (showAppShell) "crewcue://dev/map" else url.orEmpty()
        val screen = decode(container.featureScreenJson(fetchUrl))
        val state = if (showAppShell) "success" else queryState(fetchUrl)
        uiState = UiState.from(screen, state)
        routeId = if (showAppShell) "app-shell" else "${screen.featureId}?state=$state"
    }

    private fun decode(json: String): ScreenCopy {
        val obj = JSONObject(json)
        return ScreenCopy(
            featureId = obj.getString("featureId"),
            accessibilityIdentifier = obj.getString("accessibilityIdentifier"),
            title = obj.getString("title"),
            body = obj.getString("body")
        )
    }

    private fun queryState(url: String): String {
        val query = url.substringAfter('?', missingDelimiterValue = "")
        if (query.isEmpty()) return "success"
        for (pair in query.split('&')) {
            val bits = pair.split('=', limit = 2)
            if (bits.size == 2 && bits[0] == "state") return bits[1]
        }
        return "success"
    }

    private companion object {
        val placeholder = ScreenCopy(
            featureId = "app-shell",
            accessibilityIdentifier = "crewcue.app-shell",
            title = "CrewCue",
            body = ""
        )
    }
}

class ShellViewModelFactory(
    private val container: AppContainer,
    private val initialUrl: String?
) : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        return ShellViewModel(container, initialUrl) as T
    }
}
