import Foundation
import Testing
@testable import CrewCueClientCore

@Test func courseRouteLineReadsTheSavedGpxLine() {
    let json = """
    {"room":{"course":{"checkpoints":[
      {"id":"a","title":"A","latitude":40.0,"longitude":-105.0,"distanceMetersFromStart":0},
      {"id":"b","title":"B","latitude":40.1,"longitude":-105.1,"distanceMetersFromStart":2000}
    ]},
    "mapWorkspace":{"drivesProjectionLayerId":"course","layers":[
      {"id":"other","geometry":{"type":"LineString","coordinates":[[0,0],[1,1]]}},
      {"id":"course","geometry":{"type":"LineString","coordinates":[[-105.0,40.0,1600],[-105.03,40.02],[-105.07,40.06,1700],[-105.1,40.1]]}}
    ]}}}
    """
    let line = CourseRouteLine.points(roomData: Data(json.utf8))
    #expect(line.count == 4)
    #expect(line[1] == CourseRoutePoint(latitude: 40.02, longitude: -105.03))
    #expect(line[0].elevationMeters == 1600)
}

@Test func courseRouteLineJoinsMultiLineStringParts() {
    let json = """
    {"room":{"mapWorkspace":{"layers":[
      {"id":"course","geometry":{"type":"MultiLineString","coordinates":[[[-105.0,40.0],[-105.01,40.01]],[[-105.02,40.02],[-105.03,40.03]]]}}
    ]}}}
    """
    #expect(CourseRouteLine.points(roomData: Data(json.utf8)).count == 4)
}

@Test func courseRouteLineIsEmptyWithoutASavedLine() {
    #expect(CourseRouteLine.points(roomData: Data(#"{"room":{"course":{"checkpoints":[]}}}"#.utf8)).isEmpty)
    #expect(CourseRouteLine.points(roomData: Data("not json".utf8)).isEmpty)
    let single = #"{"room":{"mapWorkspace":{"layers":[{"id":"c","geometry":{"type":"LineString","coordinates":[[-105,40],[999,40]]}}]}}}"#
    #expect(CourseRouteLine.points(roomData: Data(single.utf8)).isEmpty)
}

@Test func coordinateTextReadsPastedPositions() {
    let boulder = CoordinateText.Coordinate(latitude: 40.015, longitude: -105.2705)
    #expect(CoordinateText.parse("40.015, -105.2705") == boulder)
    #expect(CoordinateText.parse("40.015 -105.2705") == boulder)
    #expect(CoordinateText.parse("  (40.015,-105.2705) ") == boulder)
    #expect(CoordinateText.parse("40.015° N, 105.2705° W") == boulder)
    #expect(CoordinateText.parse("105.2705 W 40.015 N") == boulder)
    #expect(CoordinateText.parse("33.9 S, 151.2 E") == CoordinateText.Coordinate(latitude: -33.9, longitude: 151.2))
}

@Test func coordinateTextRejectsWhatIsNotAPosition() {
    #expect(CoordinateText.parse("") == nil)
    #expect(CoordinateText.parse("40.015") == nil)
    #expect(CoordinateText.parse("40, -105, 12") == nil)
    #expect(CoordinateText.parse("91, 0") == nil)
    #expect(CoordinateText.parse("0, 181") == nil)
    #expect(CoordinateText.parse("Boulder") == nil)
    #expect(CoordinateText.parse("40 N 50 N") == nil)
}

@Test func coordinateTextFormatsSixDecimals() {
    #expect(CoordinateText.format(latitude: 40.015, longitude: -105.2705) == "40.015000, -105.270500")
    #expect(CoordinateText.parse(CoordinateText.format(latitude: 1.5, longitude: -2.25)) == CoordinateText.Coordinate(latitude: 1.5, longitude: -2.25))
}
