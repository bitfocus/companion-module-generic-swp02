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

Messages still waiting to be sent are merged. A destination asked for more than once is interrogated once, and several
Connects to one destination go as a single Connect, with the last source chosen, in the place of the first. Nothing is
merged across a Go.

## Variables

- **Destination** Returns the source number connected to a destination, or `unknown` until the router reports it.

## Feedbacks

- **Crosspoint** True when the specified crosspoint is connected

## Action Recorder

The Action Recorder will translate any received tally or connected messages into new connect actions, to quickly build
salvos.
