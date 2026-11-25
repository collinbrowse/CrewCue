# invite-share

## Entry
crewcue://dev/invite-share

## Action
The runner opens Profile, then Room members, then Invite crew. The screen shows the race's 6-digit invite code in large type, the join link `https://collinbrowse.github.io/crewcue/join/?code=<code>`, Share invite (the system share sheet with `InviteLink.shareText`, which carries the link and the code), and Copy code. Invites stay with the runner: crew members don't see Invite crew. A race that isn't unlocked says crew can join once it is.

## API
GET /race-rooms/:roomId (`joinCode`, `name`, `entitlement.status`)

## Permissions
none

## Success
Invite ready to share.

## Empty
No invite code for this race yet.

## Error
Couldn't load the invite. A race not unlocked yet also shows: Crew can join once you unlock this race.

## Offline
Offline. The invite needs the network.

## Accessibility labels
- crewcue.invite-share
- crewcue.invite-share.code
- crewcue.invite-share.link
- crewcue.invite-share.share
- crewcue.room-members.invite

## Native SDK pocket
none
