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
    dependencies: [
        .package(url: "https://github.com/apple/swift-crypto.git", from: "3.12.0")
    ],
    targets: [
        .target(
            name: "CrewCueClientCore",
            dependencies: [
                .product(name: "Crypto", package: "swift-crypto")
            ]
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
