"use strict";
var EventEmitter = require('events').EventEmitter;
var util = require('util');
function Protocol($config) {
    this.config = $config;
    var self = this;
    this.clients = {};
    this.commands = {};
    if ($config.pingInterval > 0 && $config.pingInterval > 0) {
        this.addCommand('pong', function (client) {
//            console.log(self.constructor.name,'pong')
            clearTimeout(client.pingTimeoutHandle);
        });
        //если надо пинговать - заводим таймаут пинга

        self.pingIntervalHandle = setInterval(function () {
            for (var i in self.clients) {
                var client = self.clients[i];
                client.send({cmd: 'ping'});
                self.refreshPingTimeoutHandle(client);
            }
        }, self.config.pingInterval);
    }

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

Protocol.prototype.refreshPingTimeoutHandle = function (client) {
    var self = this;
    clearTimeout(client.pingTimeoutHandle);
    client.pingTimeoutHandle = setTimeout(function () {
        //не успел ответить на пинг - закрыли соединение
        client.connection.close(1000);
//        console.log(self.constructor.name, "closed by timeout");
    }, 1000);//сенадо именно столько, 1 секунды на пинг вполне достаточно
}

/**
 * принимает обьект типа клиент с методами (send(),close())
 * @function
 * @param {Client} client
 * @param {Function} client.send()
 * @param {Function} client.close()
 */
Protocol.prototype.listenToClient = function (client) {
//принимает клиента, подписывается на события сокета и выполняет его команды
    var self = this;
    var token = client.profile.token;
//    console.log('token', token);
    if (token) {    //если токены используются
        var another = self.clients[token];
        if (another) {//случай, когда 2 клиена с 1 токеном:
            //возможен если:
            // 1) подключается читер и честный одновременно
            //      последнего предупредим о том что токен используется и закроем соединение
            //      первый если что - отвалится по таймауту
            //      в данном случае мы не знаем,кто из них настоящий

            // 2) сокет повис на сервере, а на клиенте закрыт - тогда клиент честно переподключается
            //следовательно надо освободить сокет

            //алгоритм:
            //старый клиент отвалится по таймауту пинга, автоматически освободив место новому подключению
            //новый переподключится - все ОК

            self.emit('twice login', token);
            //если клиента надо постоянно пинговать, заводим интервал пинга
            // и таймаут закрытия соединения, если клиент не успел ответить

            client.send({cmd: 'auth_e_twice_login', code: 'twice token usage'});
            client.close(1000);
            return;
        }
        //если токен уникален, просто добавляем его в "клиенты"
        self.clients[token] = client;
    } else {
        //если без токена, а он нужен - просто закрываем соединение
        if (self.config.requireToken) {
            client.connection.close(1000);
        }
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
            //            delete client.connection;

            if (token) {
                delete self.clients[token];
            }
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
            if (typeof self.commands[msg.cmd] == 'function') {
                self.commands[msg.cmd](client, msg);
            } else {
                client.send({cmd: 'error', code: 'not supported', data: msg.cmd});
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
//    console.log(eventName, 'client.connection', !!client.connection)
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
}

module.exports = Protocol;

