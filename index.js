"use strict";
var EventEmitter = require('events').EventEmitter;
var util = require('util');
function Protocol() {

    this.clients = {};
    this.commands = {};
}

util.inherits(Protocol, EventEmitter);

/**
 * adding new command
 * @function
 * @param {String} name
 * @param {Function} fn
 */
Protocol.prototype.addCommand = function (name, fn) {
    if (typeof  fn !== "function") {
        throw Error('command must be a function');
    }
    if (typeof  name !== "string") {
        throw Error('command name must be a string');
    }
    this.commands[name] = fn;
};

/**
 * returning a client by token
 * @function
 * @param {String} token
 */
Protocol.prototype.getClient = function (token) {
    return this.clients[token];
};

/**
 * принимает обьект типа клиент с методами (send(),close())
 * @function
 * @param {Client} client
 * @param {Function} client.send()
 * @param {Function} client.close()
 */
Protocol.prototype.listenToClient = function (client) {
//принимает клиента, подписывается на события сокета и выполняет его команды
    //для совместимости со старыми версиями ConnectionServer будем расширять объект клиента
    var self = this;

    /**
     * подписываться сразу на события json, dead объекта Client
     *
     * если соединение закрывается, просто отписываемся от клиента
     * если клиента надо передать в другой протокол, генерируем событие client
     */

    var token = client.profile.token;
    if (token) {    //если токены используются
        var another = self.clients[token];
        if (another) {
//            console.log('twice login',token)
            another.send({cmd: 'ping'});
            clearTimeout(another.pingTimeoutHandle);
            another.pingTimeoutHandle = setTimeout(function () {
                another.close(1000);
            }, 1000);
            client.send({cmd: 'twice_login', code: 'twice token usage'});
            client.close(1000);
            return;
        }
        self.clients[token] = client;
    }


    client.once('dead', onClientConnectionDead);
    client.on('json', onClientMessage);

    /**
     * socket close event handler
     * @function
     */
    function onClientConnectionDead() {
        //от событий сокета клиент отписался сам!!!
        //   console.log('events', client.connection._events,client._events);
        //отписываемся от событий клиента
        this.removeAllListeners();
        clearTimeout(client.pingTimeoutHandle);
//            console.log(self.constructor.name, "unbind", Object.keys(self.clients));
//        console.log('onClientConnectionDead events', client.connection._events, client._events);
        if (token) {
            delete self.clients[token];
        }
    }


    /**
     * пришла команда из сокета(это не response)
     * @function
     * @param {Object} msg
     */
    function onClientMessage(msg) {
        //console.log(msg)
        if (typeof self.commands[msg.cmd] == 'function') {
            self.commands[msg.cmd](client, msg);
        } else {
            //чтобы у клиента не висели коллбеки, подставляем ид запроса(если есть)
            client.send({cmd: 'error', code: 'not supported', data: msg.cmd, __: msg.__});
        }
    }
};

/**
 * unbind client from protocol instance and optional push it to next protocol listener
 * @function
 * @param {Client} client
 * @param {String} eventName если не null, генерирует событие, в котором передает client дальше
 */
Protocol.prototype.unbindClient = function (client, eventName) {
//принимает клиента, отписывается от его событий и удаляет ссылки на него
    if (eventName) {
        client.removeAllListeners();
  //      console.log(this.constructor.name, "unbind", Object.keys(client._events), Object.keys(client.connection._events))
        this.emit(eventName, client);
    } else {    //если не передаем имя события, это значит что клиент не нужен и его надо отсоединить
        client.connection.close(1000);
        //обработчики событий чистятся в onClientConnectionDead()
//        console.log(this.constructor.name, "unbindClient", client.connection._events);
    }
};
Protocol.prototype.broadcast = function (cmd) {
    for (var i in this.clients) {
        this.clients[i].send(cmd);
    }
}

module.exports = Protocol;

