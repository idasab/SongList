// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "SonglistNative",
    platforms: [.iOS(.v15)],
    products: [
        .library(
            name: "SonglistNative",
            targets: ["SongListNativePlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0")
    ],
    targets: [
        .target(
            name: "SongListNativePlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm")
            ],
            path: "ios/Sources/SongListNativePlugin")
    ]
)
