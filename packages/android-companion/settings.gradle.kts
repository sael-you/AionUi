// AionUi companion app (TASK-136 A1): a standalone Gradle project inside the ui repo.
// Not a bun workspace: it has no package.json on purpose.
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "aionui-companion"
include(":app")
