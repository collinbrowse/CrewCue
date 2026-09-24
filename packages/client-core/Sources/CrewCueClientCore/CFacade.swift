#if canImport(Darwin)
import Darwin
#elseif canImport(Glibc)
import Glibc
#elseif canImport(Android)
import Android
#endif

@_cdecl("crewcue_hello_stamp")
public func crewcue_hello_stamp() -> UnsafeMutablePointer<CChar>? {
    strdup(CrewCueClientCore.helloStamp())
}

@_cdecl("crewcue_feature_screen_json_for_url")
public func crewcue_feature_screen_json_for_url(_ url: UnsafePointer<CChar>?) -> UnsafeMutablePointer<CChar>? {
    let value = url.map { String(cString: $0) } ?? ""
    return strdup(CrewCueClientCore.featureScreenJSON(forCrewCueURL: value))
}
