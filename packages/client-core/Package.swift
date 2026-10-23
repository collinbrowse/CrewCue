// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "CrewCueClientCore",
    platforms: [
        .macOS(.v14),
        .iOS(.v17)
    ],
    products: [
        .library(name: "CrewCueClientCore", targets: ["CrewCueClientCore"])
    ],
    targets: [
        .target(
            name: "CrewCueClientCore"
        ),
        .testTarget(
            name: "CrewCueClientCoreTests",
            dependencies: ["CrewCueClientCore"],
            resources: [
                .copy("Fixtures/health-status.json")
            ]
        )
    ]
)
