plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

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
    }

    sourceSets {
        getByName("main") {
            java.srcDir(layout.buildDirectory.dir("generated/swift-java"))
            jniLibs.srcDir(layout.buildDirectory.dir("generated/jniLibs"))
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
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui-tooling-preview")

    androidTestImplementation(composeBom)
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test:runner:1.6.2")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
}

val buildSwiftAndroid = tasks.register<Exec>("buildSwiftAndroid") {
    group = "build"
    description = "Cross-compile packages/client-core with the Swift Android SDK and stage the JNI libraries."
    workingDir = rootProject.projectDir
    commandLine("node", repoRoot.resolve("scripts/build-swift-android.mjs").path)
    inputs.dir(repoRoot.resolve("packages/client-core/Sources"))
    inputs.file(repoRoot.resolve("packages/client-core/Package.swift"))
    inputs.file(repoRoot.resolve("scripts/build-swift-android.mjs"))
    inputs.property("configuration", System.getenv("SWIFT_BUILD_CONFIGURATION") ?: "debug")
    outputs.dir(layout.buildDirectory.dir("generated/jniLibs"))
}

tasks.named("preBuild") { dependsOn(buildSwiftAndroid) }
