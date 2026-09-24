plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "com.crewcue.android"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.crewcue.android"
        minSdk = 28
        targetSdk = 35
        versionCode = 1
        versionName = "1.0"
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
    }

    sourceSets {
        getByName("main") {
            java.srcDir(layout.buildDirectory.dir("generated/swift-java"))
            jniLibs.srcDir(layout.buildDirectory.dir("generated/jniLibs"))
        }
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.10.01")
    implementation(composeBom)
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui-tooling-preview")
}

tasks.register<Exec>("buildSwiftAndroid") {
    group = "build"
    description = "Cross-compile packages/client-core with the Swift Android SDK and run swift-java jextract."
    workingDir = rootProject.projectDir
    commandLine("node", "../../scripts/build-swift-android.mjs")
}
