/*
 * Copyright (c) 2013 Heartland Payment Systems
 *
 * Copyright (c) 2011 Vinay Pulim <vinay@milewise.com>
 * MIT Licensed
 */

'use strict';

var http = require('./http'),
    assert = require('assert'),
    url = require('url');

function findKey(obj, val) {
    var n, result;
    for (n in obj) {
        if (obj.hasOwnProperty(n) && obj[n] === val) { result = n; break; }
    }

    return result;
}

var Client = function (wsdl, endpoint) {
    this.wsdl = wsdl;
    this._initializeServices(endpoint);
};

Client.prototype.addSoapHeader = function (soapHeader, name, namespace, xmlns) {
    if (!this.soapHeaders) { this.soapHeaders = []; }
    if (typeof soapHeader === 'object') {
        soapHeader = this.wsdl.objectToXML(soapHeader, name, namespace, xmlns);
    }

    this.soapHeaders.push(soapHeader);
};

Client.prototype.setEndpoint = function (endpoint) {
    this.endpoint = endpoint;
    this._initializeServices(endpoint);
};

Client.prototype.describe = function () {
    return this.wsdl.describeServices();
};

Client.prototype.setSecurity = function (security) {
    this.security = security;
};

Client.prototype.setSOAPAction = function (SOAPAction) {
    this.SOAPAction = SOAPAction;
};

Client.prototype._initializeServices = function (endpoint) {
    var definitions = this.wsdl.definitions,
        services = definitions.services,
        name;

    for (name in services) {
        if (services.hasOwnProperty(name)) {
            this[name] = this._defineService(services[name], endpoint);
        }
    }
};

Client.prototype._defineService = function (service, endpoint) {
    var ports = service.ports,
        def = {},
        name;

    for (name in ports) {
        if (ports.hasOwnProperty(name)) {
            def[name] = this._definePort(ports[name], endpoint || ports[name].location);
        }
    }

    return def;
};

Client.prototype._definePort = function (port, endpoint) {
    var binding = port.binding,
        methods = binding.methods,
        def = {},
        name;

    for (name in methods) {
        if (methods.hasOwnProperty(name)) {
            def[name] = this._defineMethod(methods[name], endpoint);
            if (!this[name]) { this[name] = def[name]; }
        }
    }

    return def;
};

Client.prototype._defineMethod = function (method, location) {
    var self = this;

    return function (args, callback) {
        if (typeof args === 'function') {
            callback = args;
            args = {};
        }

        self._invoke(method, args, location, function (error, result, raw) {
            callback(error, result, raw);
        });
    };
};

Client.prototype._invoke = function (method, args, location, callback) {
    var self = this,
        name = method.$name,
        input = method.input,
        output = method.output,
        style = method.style,
        definitions = this.wsdl.definitions,
        ns = definitions.$targetNamespace,
        encoding = '',
        message = '',
        xml,
        soapAction = this.SOAPAction || method.soapAction,
        headers = {
            SOAPAction: '"' + soapAction + '"',
            'Content-Type': "text/xml; charset=utf-8"
        },
        options = {},
        alias = findKey(definitions.xmlns, ns);

    // Allow the security object to add headers
    if (self.security && self.security.addHeaders) { self.security.addHeaders(headers); }
    if (self.security && self.security.addOptions) { self.security.addOptions(options); }

    if (input.parts) {
        assert.ok(!style || style === 'rpc', 'invalid message definition for document style binding');
        message = self.wsdl.objectToRpcXML(name, args, alias, ns);
        (method.inputSoap === 'encoded') && (encoding = 'soap:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/" ');
    } else if (typeof args === 'string') {
        message = args;
    } else {
        assert.ok(!style || style === 'document', 'invalid message definition for rpc style binding');
        message = self.wsdl.objectToDocumentXML(input.$name, args, input.targetNSAlias, input.targetNamespace);
    }

    xml = "<soap:Envelope " +
            "xmlns:soap=\"http://schemas.xmlsoap.org/soap/envelope/\" " +
            encoding + this.wsdl.xmlnsInEnvelope + '>' +
        "<soap:Header>" +
            (self.soapHeaders ? self.soapHeaders.join("\n") : "") +
            (self.security ? self.security.toXML() : "") +
        "</soap:Header>" +
        "<soap:Body>" +
            message +
        "</soap:Body>" +
        "</soap:Envelope>";

    self.lastRequest = xml;
    http.request(location, xml, async function (err, response, body) {
        var obj, result;
        if (err) {
            callback(err);
        } else {
            try {
                obj = await self.wsdl.xmlToObject(body);
            } catch (error) {
                return callback(error, response, body);
            }

            result = obj.Body[output.$name];

            // RPC/literal response body may contain element named after the method + 'Response'
            // This doesn't necessarily equal the ouput message name. See WSDL 1.1 Section 2.4.5
            if (!result) { result = obj.Body[name + 'Response']; }
            callback(null, result, body);
        }
    }, headers, options);
};

exports.Client = Client;
