import { HostRepository } from "../hosts/host.repository.ts";
import logger from "../logger.ts";
import { udpRelayHandler } from "../relay/relay.ts";
import { RelayEntry } from "../relay/relay.entry.ts";
import { NetAddress } from "../relay/net.address.ts";
import { NorayReactor } from "../noray.ts";
import { HostEntity } from "../hosts/host.entity.ts";
import { assert } from "../assert.ts";

/**
 * Handle a direct connect request, replying with the peers' addresses.
 *
 * @param name Command name to listen on, and to reply with
 */
export function handleConnect(hostRepository: HostRepository, name = "connect") {
  return function(server: NorayReactor) {
    server.on(name, (command, exchange) => {
      const log = logger.child({ name: `cmd:${name}` });

      const socket = exchange.source;
      const oid = command.requireText();
      const host = hostRepository.find(oid);
      const client = hostRepository.findBySocket(socket);

      log.debug(
        { oid, address: socket.remoteAddress, port: socket.remotePort },
        "Client attempting to connect to host",
      );

      assert(host, "Unknown host oid: " + oid);
      assert(host.remoteAddress, "Host has no remote address registered!");
      assert(host.remotePort, "Host has no remote port registered!");
      assert(client, "Unknown client from address");
      assert(client.remoteAddress, "Client has no remote address registered!");
      assert(client.remotePort, "Client has no remote port registered!");

      const hostAddress = stringifyAddressOf(host);
      const clientAddress = stringifyAddressOf(client);

      server.send(socket, { name, params: [hostAddress] });
      server.send(host.socket, { name, params: [clientAddress] });

      log.debug(
        { client: clientAddress, host: hostAddress, oid },
        "Connected client to host",
      );
    });
  };
}

export function handleConnectRelay(hostRepository: HostRepository) {
  return function(server: NorayReactor) {
    server.on("connect-relay", (command, exchange) => {
      const log = logger.child({ name: "cmd:connect-relay" });

      const socket = exchange.source;
      const oid = command.requireText();
      const host = hostRepository.find(oid);
      const client = hostRepository.findBySocket(socket);

      log.debug(
        {
          oid,
          remoteAddress: socket.remoteAddress,
          remotePort: socket.remotePort,
        },
        "Client attempting to connect to host",
      );
      assert(host, "Unknown host oid: " + oid);
      assert(client, "Unknown client from address");

      log.debug("Ensuring relay for both parties");
      const hostRelay = getRelayFor(host);
      const clientRelay = getRelayFor(client);
      host.relay = hostRelay.port;
      client.relay = clientRelay.port;

      // Remember who is talking to whom, so a sender whose NAT-mapped address
      // differs from the registered one can be identified without guessing
      hostRelay.peer = clientRelay;
      clientRelay.peer = hostRelay;

      log.debug(
        { host: host.relay, client: client.relay },
        "Replying with relay",
      );
      server.send(socket, {
        name: "connect-relay",
        params: [host.relay!.toString()],
      });
      server.send(host.socket, {
        name: "connect-relay",
        params: [client.relay!.toString()],
      });
      log.debug(
        {
          client: `${socket.remoteAddress}:${socket.remotePort}`,
          relay: host.relay,
          oid,
        },
        "Connected client to host",
      );
    });
  };
}

function stringifyAddressOf(host: HostEntity) {
  return `${host.remoteAddress}:${host.remotePort}`;
}

function getRelayFor(host: HostEntity): RelayEntry {
  // Attempt to create new relay on each connect
  // If there's a relay already, UDPRelayHandler will return that
  // If there's no relay, or it has expired, a new one will be created
  const log = logger.child({ name: "getRelay" });
  log.trace(
    {
      host: {
        oid: host.oid,
        address: host.remoteAddress,
        port: host.remotePort,
      },
    },
    "Ensuring relay for host",
  );

  const relayEntry = udpRelayHandler.createRelay(
    new RelayEntry({
      address: new NetAddress({
        address: host.remoteAddress!,
        port: host.remotePort!,
      }),
      port: -1, // Set by the handler
    }),
  );

  log.trace(
    { relayEntry },
    "Created relay, returning with port %d",
    relayEntry.port,
  );
  return relayEntry;
}
