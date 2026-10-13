plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

// Newest OpenGL MapLibre that this AGP can consume. A failed resolve must not fail the build.
val mapLibreCandidates = listOf("12.3.1", "11.11.0")
var mapLibreVersionResolved: String? = null
val mapLibreFailures = mutableListOf<String>()
for (version in mapLibreCandidates) {
    try {
        configurations.detachedConfiguration(
            dependencies.create("org.maplibre.gl:android-sdk:$version")
        ).resolve()
        mapLibreVersionResolved = version
        break
    } catch (error: Throwable) {
        val line = (error.message ?: error.toString()).lineSequence().first().take(300)
        mapLibreFailures += "$version: $line"
    }
}
val mapLibreFailure = if (mapLibreVersionResolved == null) mapLibreFailures.joinToString(" | ") else ""

// Stream stays off the compile classpath when it does not resolve for this AGP and SDK.
val streamCandidates = listOf(
    "io.getstream:stream-chat-android-client:6.45.1"
)
var streamCoordinate: String? = null
val streamFailures = mutableListOf<String>()
for (coordinate in streamCandidates) {
    try {
        configurations.detachedConfiguration(dependencies.create(coordinate)).resolve()
        streamCoordinate = coordinate
        break
    } catch (error: Throwable) {
        val line = (error.message ?: error.toString()).lineSequence().first().take(300)
        streamFailures += "$coordinate: $line"
    }
}
val streamFailure = if (streamCoordinate == null) streamFailures.joinToString(" | ") else ""

android {
    namespace = "com.crewcue.android"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.crewcue.android"
        minSdk = 28
        targetSdk = 35
        versionCode = 1
        versionName = "1.0"

        val auth0Domain = crewcueResolved("crewcue_auth0_domain")
        val auth0ClientId = crewcueResolved("crewcue_auth0_client_id")
        val auth0Audience = crewcueResolved("crewcue_auth0_audience")
        val apiBaseUrl = crewcueResolved("crewcue_api_base_url")
        buildConfigField("String", "crewcue_auth0_domain", crewcueQuoted(auth0Domain))
        buildConfigField("String", "crewcue_auth0_client_id", crewcueQuoted(auth0ClientId))
        buildConfigField("String", "crewcue_auth0_audience", crewcueQuoted(auth0Audience))
        buildConfigField("String", "crewcue_api_base_url", crewcueQuoted(apiBaseUrl))
        buildConfigField("boolean", "MAP_LIBRE", (mapLibreVersionResolved != null).toString())
        buildConfigField("String", "MAP_LIBRE_VERSION", crewcueQuoted(mapLibreVersionResolved ?: ""))
        buildConfigField("String", "MAP_LIBRE_ERROR", crewcueQuoted(mapLibreFailure))
        buildConfigField("boolean", "STREAM_CHAT", (streamCoordinate != null).toString())
        buildConfigField("String", "STREAM_CHAT_COORDINATE", crewcueQuoted(streamCoordinate ?: ""))
        buildConfigField("String", "STREAM_CHAT_ERROR", crewcueQuoted(streamFailure))
        manifestPlaceholders["auth0Domain"] = auth0Domain.ifBlank { "auth0.invalid" }
        manifestPlaceholders["auth0Scheme"] = "crewcue"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    packaging {
        jniLibs {
            pickFirsts += "**/libc++_shared.so"
        }
    }

    sourceSets {
        getByName("main") {
            java.srcDir(layout.buildDirectory.dir("generated/swift-java"))
            jniLibs.srcDir(layout.buildDirectory.dir("generated/jniLibs"))
            if (mapLibreVersionResolved != null) {
                kotlin.srcDir("src/maplibre/kotlin")
            }
            if (streamCoordinate != null) {
                kotlin.srcDir("src/stream/kotlin")
            }
        }
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.10.01")
    implementation(composeBom)
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    implementation("androidx.lifecycle:lifecycle-viewmodel-ktx:2.8.7")
    implementation("androidx.navigation:navigation-compose:2.8.3")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("com.auth0.android:auth0:3.21.1")
    mapLibreVersionResolved?.let { version ->
        implementation("org.maplibre.gl:android-sdk:$version")
    }
    streamCoordinate?.let { coordinate ->
        implementation(coordinate)
    }
}

fun Project.crewcueProp(name: String): String = (findProperty(name) as? String)?.trim().orEmpty()

fun Project.crewcueResolved(name: String): String {
    val strings = file("src/main/res/values/strings.xml")
    val fromResource = if (!strings.exists()) {
        ""
    } else {
        Regex("""<string\s+name="$name">([^<]*)</string>""")
            .find(strings.readText())
            ?.groupValues
            ?.getOrNull(1)
            ?.trim()
            .orEmpty()
    }
    return fromResource.ifBlank { crewcueProp(name) }
}

fun crewcueQuoted(value: String): String =
    "\"" + value
        .replace("\\", "\\\\")
        .replace("\"", "\\\"")
        .replace("\r", "")
        .replace("\n", "\\n") + "\""

tasks.register<Exec>("buildSwiftAndroid") {
    group = "build"
    description = "Cross-compile packages/client-core with the Swift Android SDK and run swift-java jextract."
    workingDir = rootProject.projectDir
    commandLine("node", "../../scripts/build-swift-android.mjs")
}
