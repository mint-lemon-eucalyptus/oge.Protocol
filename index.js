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
 * @param {Function} client.send
 * @param {Function} client.close
 */
Protocol.prototype.listenToClient = function (client) {
//принимает клиента, подписывается на события сокета и выполняет его команды
    var self = this;

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
            client.send({cmd: 'auth_e_twice_login', code: 'twice token usage'});
            client.close(1000);
            return;
        }
        self.clients[token] = client;
    }


    setSocketListeners(client.connection);

    function setSocketListeners(socket) {
        socket.once('close', onClose);
        socket.once('error', onError);
        socket.on('message', onMessage);
        socket.once('unbind', onUnbind);

        /**
         * unbinding from handlers
         * @function
         */
        function onUnbind() {
            //если клиента надо передать другому протоколу
            this.removeListener('message', onMessage);
            this.removeListener('error', onError);
            this.removeListener('close', onClose);
            clearTimeout(client.pingTimeoutHandle);
//            console.log(self.constructor.name, "unbind", Object.keys(self.clients));
//            console.log('events', client.connection._events)
            if (token) {
                delete self.clients[token];
            }
        }

        /**
         * socket close event handler
         * @function
         * @param {Number} code
         */
        function onClose(code) {
            //соединение разорвал клиент
            this.removeListener('message', onMessage);
            this.removeListener('error', onError);
            this.removeListener('unbind', onUnbind);
            this.emit('unbind');
            clearTimeout(client.pingTimeoutHandle);
            delete client.pingTimeoutHandle;
            //   delete client.profile;
            delete client.connection;
            //          console.log('onClose',token)
            if (token) {
//                delete self.clients[token];
                delete self.clients[token];
            }
            //       console.log('events', client.connection._events)
            console.log(self.constructor.name, 'close', Object.keys(self.clients));
        }

        /**
         * socket error event handler
         * @function
         * @param {Object} err error message object
         */
        function onError(err) {
            //соединение разорвал клиент
            this.removeListener('close', onClose);
            this.removeListener('unbind', onUnbind);
            this.removeListener('message', onMessage);
            if (token) {
                delete self.clients[token];
            }
        }

        /**
         * incoming socket data handler
         * @function
         * @param {String} message
         */
        function onMessage(message) {
            var msg;
            try {
                msg = JSON.parse(message);
            } catch
                (e) {
                this.close(1000);
                return;
            }

            var reqId = msg.__;
            var callback = client.__callbacks[reqId];
            console.log('received', msg);
            if (callback) {  //коллбек остался, подставим туда данные
                delete msg.__;
                callback(null, msg);
                delete client.__callbacks[reqId];
            } else {
                //это сообщение - инициатива другой стороны.
                //надо обработать его как команду(для совместимости со старой версией)
                var cmdName = msg.cmd;
                if (typeof self.commands[cmdName] == "function") {
                    self.commands[cmdName](client, msg);    //тут надо передать контекст
                }
                else {
                    client.send({cmd: 'error', code: 'not supported', data: msg.cmd});
                }
            }
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
    client.connection.emit('unbind');   //чистим ссылки внитри текущего инстанса протокола
    if (eventName) {
        this.emit(eventName, client);
    } else {
        client.close(1000);
    }
};
Protocol.prototype.broadcast = function (cmd) {
    for (var i in this.clients) {
        this.clients[i].send(cmd);
    }
};

module.exports = Protocol;

