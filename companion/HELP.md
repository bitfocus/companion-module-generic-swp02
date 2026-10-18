## ProBel SW-P-02 General Switcher Communication Protocol

Implementation referenced to SW-P-02 Issue 37. 07/09/2017.

This module implements the basic router controls of SW P 02, for routers of up to 1024 sources and 1024 destinations.

Requires Companion 5.1 or later.

## Configuration

Enter the IP address, port and source and destination count.

**Wait for ACK** holds each message until the router replies, or for up to a second, before sending the next. SW-P-02
has no acknowledgement of its own, so any message from the router counts as the reply. Routers that do not answer
CONNECT ON GO will make a salvo slow to prepare with this on.

**Interrogate on connect** interrogates all destinations when a connection is established. With it off, only the
destinations used by feedbacks and by Connect and Interrogate actions are interrogated.

The module sends a keepalive every 30 seconds. A router that has answered it, and then sends nothing for a minute, is
taken to have gone, and the module reconnects.

## Actions

- **Interrogate**
- **Connect**
- **Connect on Go**
- **Go** Set / Clear

Destinations and sources are chosen from a list, or with an expression. An expression must return a destination
number from 1 to the destination count, or a source number from 1 to the source count. For Go it must return 0 to set,
or 1 to clear. Anything else and the action is not run.

A button pressed while all destinations are being interrogated is sent ahead of the remaining interrogations.

## Variables

- **Destination** Returns the source number connected to a destination, or `unknown` until the router reports it.

## Feedbacks

- **Crosspoint** True when the specified crosspoint is connected

## Action Recorder

The Action Recorder will translate any received tally or connected messages into new connect actions, to quickly build
salvos.

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
