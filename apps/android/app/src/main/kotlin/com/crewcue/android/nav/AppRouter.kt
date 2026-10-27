package com.crewcue.android.nav

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.crewcue.android.ui.ShellScreen
import com.crewcue.android.ui.ShellViewModel

@Composable
fun AppRouter(viewModel: ShellViewModel) {
    val navController = rememberNavController()
    NavHost(navController = navController, startDestination = viewModel.routeId) {
        composable(
            route = "{featureId}?state={state}",
            arguments = listOf(
                navArgument("featureId") { type = NavType.StringType },
                navArgument("state") {
                    type = NavType.StringType
                    defaultValue = "success"
                }
            )
        ) {
            ShellScreen(viewModel)
        }
    }
    var seen by remember { mutableStateOf(false) }
    LaunchedEffect(viewModel.routeId) {
        if (!seen) {
            seen = true
            return@LaunchedEffect
        }
        navController.navigate(viewModel.routeId) {
            popUpTo(navController.graph.id) { inclusive = true }
            launchSingleTop = true
        }
    }
}
