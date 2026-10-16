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

val repoRoot = rootProject.projectDir.parentFile.parentFile
val releaseKeystore = System.getenv("CREWCUE_ANDROID_KEYSTORE")

android {
    namespace = "com.crewcue.android"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.crewcue.android"
        minSdk = 28
        targetSdk = 35
        versionCode = (findProperty("crewcue.versionCode") as String?)?.toInt() ?: 1
        versionName = (findProperty("crewcue.versionName") as String?) ?: "0.0.0-dev"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        val auth0Domain = crewcueResolved("crewcue_auth0_domain")
        val auth0ClientId = crewcueResolved("crewcue_auth0_client_id")
        val auth0Audience = crewcueResolved("crewcue_auth0_audience")
        val apiBaseUrl = crewcueResolved("crewcue_api_base_url")
        buildConfigField("String", "crewcue_auth0_domain", crewcueQuoted(auth0Domain))
        buildConfigField("String", "crewcue_auth0_client_id", crewcueQuoted(auth0ClientId))
        buildConfigField("String", "crewcue_auth0_audience", crewcueQuoted(auth0Audience))
        buildConfigField("String", "crewcue_api_base_url", crewcueQuoted(apiBaseUrl))
        buildConfigField("String", "MAPTILER_KEY", crewcueQuoted(crewcueLocal("crewcue_maptiler_key")))
        buildConfigField("boolean", "MAP_LIBRE", (mapLibreVersionResolved != null).toString())
        buildConfigField("String", "MAP_LIBRE_VERSION", crewcueQuoted(mapLibreVersionResolved ?: ""))
        buildConfigField("String", "MAP_LIBRE_ERROR", crewcueQuoted(mapLibreFailure))
        buildConfigField("boolean", "STREAM_CHAT", (streamCoordinate != null).toString())
        buildConfigField("String", "STREAM_CHAT_COORDINATE", crewcueQuoted(streamCoordinate ?: ""))
        buildConfigField("String", "STREAM_CHAT_ERROR", crewcueQuoted(streamFailure))
        manifestPlaceholders["auth0Domain"] = auth0Domain.ifBlank { "auth0.invalid" }
        manifestPlaceholders["auth0Scheme"] = "crewcue"
    }

    signingConfigs {
        if (releaseKeystore != null) {
            create("release") {
                storeFile = file(releaseKeystore)
                storePassword = System.getenv("CREWCUE_ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("CREWCUE_ANDROID_KEY_ALIAS")
                keyPassword = System.getenv("CREWCUE_ANDROID_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            if (releaseKeystore != null) signingConfig = signingConfigs.getByName("release")
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
        getByName("androidTest") {
            assets.srcDir(repoRoot.resolve("clients/behavior"))
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

    testImplementation("junit:junit:4.13.2")
    androidTestImplementation(composeBom)
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test:runner:1.6.2")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
}

fun Project.crewcueProp(name: String): String = (findProperty(name) as? String)?.trim().orEmpty()

/** Secret from the gitignored local.properties, then Gradle properties. Empty when unset. */
fun Project.crewcueLocal(name: String): String {
    val local = rootProject.file("local.properties")
    val fromLocal = if (local.exists()) {
        local.readLines()
            .map { it.trim() }
            .firstOrNull { it.startsWith("$name=") }
            ?.substringAfter("=")
            ?.trim()
            .orEmpty()
    } else {
        ""
    }
    return fromLocal.ifBlank { crewcueProp(name) }
}

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

val buildSwiftAndroid = tasks.register<Exec>("buildSwiftAndroid") {
    group = "build"
    description = "Cross-compile packages/client-core with the Swift Android SDK and stage the JNI libraries."
    workingDir = rootProject.projectDir
    commandLine("node", repoRoot.resolve("scripts/build-swift-android.mjs").path)
    inputs.dir(repoRoot.resolve("packages/client-core/Sources"))
    inputs.file(repoRoot.resolve("packages/client-core/Package.swift"))
    inputs.file(repoRoot.resolve("scripts/build-swift-android.mjs"))
    inputs.file(repoRoot.resolve("scripts/lib/swiftAndroidToolchain.mjs"))
    inputs.property("configuration", System.getenv("SWIFT_BUILD_CONFIGURATION") ?: "debug")
    outputs.dir(layout.buildDirectory.dir("generated/jniLibs"))
}

// Package freshly built Swift every time. Without this the APK ships whatever stale .so is on disk.
tasks.named("preBuild") { dependsOn(buildSwiftAndroid) }
