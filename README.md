# companion-module-generic-swp02

See [HELP.md](./companion/HELP.md) and [LICENSE](./LICENSE)

## Version History

### Version 2.0.0

- Update to Companion module API 2.2, which needs Companion 5.1 or later
- Convert to TypeScript
- Destinations and sources take variables by expression only. Existing custom values and variables are converted
- The port is now a number field
- Wait for ACK now works: before this version the setting had no effect
- Button presses are sent ahead of the interrogation on connecting
- Messages still queued when an action is aborted are not sent
- Reconnect when a router that answers the keepalive stops responding
- A keepalive is no longer duplicated on each reconnection
- Fix destinations read from a tally whose multiplier byte had bit 3 set
- Fix connect on go acknowledgements being rejected as the wrong length
- Learn asks the router for a crosspoint it has not reported yet

### Version 1.2.4

- Parse variables with context object

### Version 1.2.3

- Use Node 22
- Update dependencies

### Version 1.2.2

- Better logging of recieved tally/connected messages

### Version 1.2.1

- Improvements to message TX and RX

### Version 1.2.0

- Allow variables in feedbacks
- Fix typos
- Update to ESM

### Version 1.1.0

- Action Recorder
- Update dependencies

### Version 1.0.4

- Better status updates
- Update companion-module-base to 1.8.0

### Version 1.0.3

- Fix typos
- Update companion-module-tools

### Version 1.0.2

- Decode & Write Dual Controller Status Response to logs
- Add feedback subscription
- Minor fixes

### Version 1.0.1

- Initial release
