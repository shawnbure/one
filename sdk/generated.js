/*eslint-disable block-scoped-var, id-length, no-control-regex, no-magic-numbers, no-mixed-operators, no-prototype-builtins, no-redeclare, no-shadow, no-var, sort-vars, default-case, jsdoc/require-param*/
import $protobuf from "protobufjs/minimal.js";

// Common aliases
const $Reader = $protobuf.Reader, $Writer = $protobuf.Writer, $util = $protobuf.util;
const $Object = $util.global.Object, $undefined = $util.global.undefined, $Error = $util.global.Error, $RangeError = $util.global.RangeError, $Array = $util.global.Array, $TypeError = $util.global.TypeError, $Number = $util.global.Number, $String = $util.global.String, $parseInt = $util.global.parseInt, $BigInt = $util.global.BigInt, $Boolean = $util.global.Boolean;

// Exported root namespace
const $root = $protobuf.roots["default"] || ($protobuf.roots["default"] = {});

export const one = $root.one = (() => {

    /**
     * Namespace one.
     * @exports one
     * @namespace
     */
    const one = {};

    one.discussion = (function() {

        /**
         * Namespace discussion.
         * @memberof one
         * @namespace
         */
        const discussion = {};

        discussion.v1 = (function() {

            /**
             * Namespace v1.
             * @memberof one.discussion
             * @namespace
             */
            const v1 = {};

            /**
             * Kind enum.
             * @name one.discussion.v1.Kind
             * @enum {number}
             * @property {number} UNSPECIFIED=0 UNSPECIFIED value
             * @property {number} NOTE=1 NOTE value
             * @property {number} QUESTION=2 QUESTION value
             * @property {number} PROPOSAL=3 PROPOSAL value
             * @property {number} CLAIM=4 CLAIM value
             * @property {number} EVIDENCE=5 EVIDENCE value
             * @property {number} OBJECTION=6 OBJECTION value
             * @property {number} COMMITMENT=7 COMMITMENT value
             * @property {number} VOTE=8 VOTE value
             * @property {number} RESOLUTION=9 RESOLUTION value
             */
            v1.Kind = (function() {
                const valuesById = $Object.create(null), values = $Object.create(valuesById);
                values[valuesById[0] = "UNSPECIFIED"] = 0;
                values[valuesById[1] = "NOTE"] = 1;
                values[valuesById[2] = "QUESTION"] = 2;
                values[valuesById[3] = "PROPOSAL"] = 3;
                values[valuesById[4] = "CLAIM"] = 4;
                values[valuesById[5] = "EVIDENCE"] = 5;
                values[valuesById[6] = "OBJECTION"] = 6;
                values[valuesById[7] = "COMMITMENT"] = 7;
                values[valuesById[8] = "VOTE"] = 8;
                values[valuesById[9] = "RESOLUTION"] = 9;
                return values;
            })();

            /**
             * Signal enum.
             * @name one.discussion.v1.Signal
             * @enum {number}
             * @property {number} NONE=0 NONE value
             * @property {number} READY=1 READY value
             * @property {number} CHANGED=2 CHANGED value
             * @property {number} RESET=3 RESET value
             */
            v1.Signal = (function() {
                const valuesById = $Object.create(null), values = $Object.create(valuesById);
                values[valuesById[0] = "NONE"] = 0;
                values[valuesById[1] = "READY"] = 1;
                values[valuesById[2] = "CHANGED"] = 2;
                values[valuesById[3] = "RESET"] = 3;
                return values;
            })();

            v1.DiscussionEvent = (function() {

                /**
                 * Properties of a DiscussionEvent.
                 * @typedef {Object} one.discussion.v1.DiscussionEvent.$Properties
                 * @property {number|null} [version] DiscussionEvent version
                 * @property {string|null} [id] DiscussionEvent id
                 * @property {string|null} [thread] DiscussionEvent thread
                 * @property {string|null} [actor] DiscussionEvent actor
                 * @property {one.discussion.v1.Kind|null} [kind] DiscussionEvent kind
                 * @property {string|null} [text] DiscussionEvent text
                 * @property {string|null} [ref] DiscussionEvent ref
                 * @property {Array.<string>|null} [evidenceRefs] DiscussionEvent evidenceRefs
                 * @property {Array.<string>|null} [artifactRefs] DiscussionEvent artifactRefs
                 * @property {string|null} [scope] DiscussionEvent scope
                 * @property {string|null} [deadline] DiscussionEvent deadline
                 * @property {string|null} [stance] DiscussionEvent stance
                 * @property {string|null} [createdAt] DiscussionEvent createdAt
                 * @property {string|null} [clientId] DiscussionEvent clientId
                 * @property {number|Long|null} [sequence] DiscussionEvent sequence
                 * @property {string|null} [actorName] DiscussionEvent actorName
                 * @property {string|null} [threadTitle] DiscussionEvent threadTitle
                 * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding when enabled
                 */

                /**
                 * Properties of a DiscussionEvent.
                 * @memberof one.discussion.v1
                 * @interface IDiscussionEvent
                 * @augments one.discussion.v1.DiscussionEvent.$Properties
                 * @deprecated Use one.discussion.v1.DiscussionEvent.$Properties instead.
                 */

                /**
                 * Shape of a DiscussionEvent.
                 * @typedef {one.discussion.v1.DiscussionEvent.$Properties} one.discussion.v1.DiscussionEvent.$Shape
                 */

                /**
                 * Constructs a new DiscussionEvent.
                 * @memberof one.discussion.v1
                 * @classdesc Represents a DiscussionEvent.
                 * @constructor
                 * @param {one.discussion.v1.DiscussionEvent.$Properties=} [properties] Properties to set
                 * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding when enabled
                 */
                const DiscussionEvent = function (properties) {
                    this.evidenceRefs = [];
                    this.artifactRefs = [];
                    if (properties)
                        for (let keys = $Object.keys(properties), i = 0; i < keys.length; ++i)
                            if (properties[keys[i]] != null && keys[i] !== "__proto__")
                                this[keys[i]] = properties[keys[i]];
                };

                /**
                 * DiscussionEvent version.
                 * @member {number} version
                 * @memberof one.discussion.v1.DiscussionEvent
                 * @instance
                 */
                DiscussionEvent.prototype.version = 0;

                /**
                 * DiscussionEvent id.
                 * @member {string} id
                 * @memberof one.discussion.v1.DiscussionEvent
                 * @instance
                 */
                DiscussionEvent.prototype.id = "";

                /**
                 * DiscussionEvent thread.
                 * @member {string} thread
                 * @memberof one.discussion.v1.DiscussionEvent
                 * @instance
                 */
                DiscussionEvent.prototype.thread = "";

                /**
                 * DiscussionEvent actor.
                 * @member {string} actor
                 * @memberof one.discussion.v1.DiscussionEvent
                 * @instance
                 */
                DiscussionEvent.prototype.actor = "";

                /**
                 * DiscussionEvent kind.
                 * @member {one.discussion.v1.Kind} kind
                 * @memberof one.discussion.v1.DiscussionEvent
                 * @instance
                 */
                DiscussionEvent.prototype.kind = 0;

                /**
                 * DiscussionEvent text.
                 * @member {string} text
                 * @memberof one.discussion.v1.DiscussionEvent
                 * @instance
                 */
                DiscussionEvent.prototype.text = "";

                /**
                 * DiscussionEvent ref.
                 * @member {string} ref
                 * @memberof one.discussion.v1.DiscussionEvent
                 * @instance
                 */
                DiscussionEvent.prototype.ref = "";

                /**
                 * DiscussionEvent evidenceRefs.
                 * @member {Array.<string>} evidenceRefs
                 * @memberof one.discussion.v1.DiscussionEvent
                 * @instance
                 */
                DiscussionEvent.prototype.evidenceRefs = $util.emptyArray;

                /**
                 * DiscussionEvent artifactRefs.
                 * @member {Array.<string>} artifactRefs
                 * @memberof one.discussion.v1.DiscussionEvent
                 * @instance
                 */
                DiscussionEvent.prototype.artifactRefs = $util.emptyArray;

                /**
                 * DiscussionEvent scope.
                 * @member {string} scope
                 * @memberof one.discussion.v1.DiscussionEvent
                 * @instance
                 */
                DiscussionEvent.prototype.scope = "";

                /**
                 * DiscussionEvent deadline.
                 * @member {string} deadline
                 * @memberof one.discussion.v1.DiscussionEvent
                 * @instance
                 */
                DiscussionEvent.prototype.deadline = "";

                /**
                 * DiscussionEvent stance.
                 * @member {string} stance
                 * @memberof one.discussion.v1.DiscussionEvent
                 * @instance
                 */
                DiscussionEvent.prototype.stance = "";

                /**
                 * DiscussionEvent createdAt.
                 * @member {string} createdAt
                 * @memberof one.discussion.v1.DiscussionEvent
                 * @instance
                 */
                DiscussionEvent.prototype.createdAt = "";

                /**
                 * DiscussionEvent clientId.
                 * @member {string} clientId
                 * @memberof one.discussion.v1.DiscussionEvent
                 * @instance
                 */
                DiscussionEvent.prototype.clientId = "";

                /**
                 * DiscussionEvent sequence.
                 * @member {number|Long} sequence
                 * @memberof one.discussion.v1.DiscussionEvent
                 * @instance
                 */
                DiscussionEvent.prototype.sequence = $util.Long ? $util.Long.fromBits(0,0,true) : 0;

                /**
                 * DiscussionEvent actorName.
                 * @member {string} actorName
                 * @memberof one.discussion.v1.DiscussionEvent
                 * @instance
                 */
                DiscussionEvent.prototype.actorName = "";

                /**
                 * DiscussionEvent threadTitle.
                 * @member {string} threadTitle
                 * @memberof one.discussion.v1.DiscussionEvent
                 * @instance
                 */
                DiscussionEvent.prototype.threadTitle = "";

                /**
                 * Creates a new DiscussionEvent instance using the specified properties.
                 * @function create
                 * @memberof one.discussion.v1.DiscussionEvent
                 * @static
                 * @param {one.discussion.v1.DiscussionEvent.$Properties=} [properties] Properties to set
                 * @returns {one.discussion.v1.DiscussionEvent} DiscussionEvent instance
                 * @type {{
                 *   (properties: one.discussion.v1.DiscussionEvent.$Shape): one.discussion.v1.DiscussionEvent & one.discussion.v1.DiscussionEvent.$Shape;
                 *   (properties?: one.discussion.v1.DiscussionEvent.$Properties): one.discussion.v1.DiscussionEvent;
                 * }}
                 */
                DiscussionEvent.create = function(properties) {
                    return new DiscussionEvent(properties);
                };

                /**
                 * Encodes the specified DiscussionEvent message. Does not implicitly {@link one.discussion.v1.DiscussionEvent.verify|verify} messages.
                 * @function encode
                 * @memberof one.discussion.v1.DiscussionEvent
                 * @static
                 * @param {one.discussion.v1.DiscussionEvent.$Properties} message DiscussionEvent message or plain object to encode
                 * @param {$protobuf.Writer} [writer] Writer to encode to
                 * @returns {$protobuf.Writer} Writer
                 */
                DiscussionEvent.encode = function (message, writer, _depth) {
                    if (!writer)
                        writer = $Writer.create();
                    if (_depth === $undefined)
                        _depth = 0;
                    if (_depth > $util.recursionLimit)
                        throw $Error("max depth exceeded");
                    if (message.version != null && $Object.hasOwnProperty.call(message, "version") && message.version !== 0)
                        writer.uint32(/* id 1, wireType 0 =*/8).uint32(message.version);
                    if (message.id != null && $Object.hasOwnProperty.call(message, "id") && message.id !== "")
                        writer.uint32(/* id 2, wireType 2 =*/18).string(message.id);
                    if (message.thread != null && $Object.hasOwnProperty.call(message, "thread") && message.thread !== "")
                        writer.uint32(/* id 3, wireType 2 =*/26).string(message.thread);
                    if (message.actor != null && $Object.hasOwnProperty.call(message, "actor") && message.actor !== "")
                        writer.uint32(/* id 4, wireType 2 =*/34).string(message.actor);
                    if (message.kind != null && $Object.hasOwnProperty.call(message, "kind") && message.kind !== 0)
                        writer.uint32(/* id 5, wireType 0 =*/40).int32(message.kind);
                    if (message.text != null && $Object.hasOwnProperty.call(message, "text") && message.text !== "")
                        writer.uint32(/* id 6, wireType 2 =*/50).string(message.text);
                    if (message.ref != null && $Object.hasOwnProperty.call(message, "ref") && message.ref !== "")
                        writer.uint32(/* id 7, wireType 2 =*/58).string(message.ref);
                    if (message.evidenceRefs != null && message.evidenceRefs.length)
                        for (let i = 0; i < message.evidenceRefs.length; ++i)
                            writer.uint32(/* id 8, wireType 2 =*/66).string(message.evidenceRefs[i]);
                    if (message.artifactRefs != null && message.artifactRefs.length)
                        for (let i = 0; i < message.artifactRefs.length; ++i)
                            writer.uint32(/* id 9, wireType 2 =*/74).string(message.artifactRefs[i]);
                    if (message.scope != null && $Object.hasOwnProperty.call(message, "scope") && message.scope !== "")
                        writer.uint32(/* id 10, wireType 2 =*/82).string(message.scope);
                    if (message.deadline != null && $Object.hasOwnProperty.call(message, "deadline") && message.deadline !== "")
                        writer.uint32(/* id 11, wireType 2 =*/90).string(message.deadline);
                    if (message.stance != null && $Object.hasOwnProperty.call(message, "stance") && message.stance !== "")
                        writer.uint32(/* id 12, wireType 2 =*/98).string(message.stance);
                    if (message.createdAt != null && $Object.hasOwnProperty.call(message, "createdAt") && message.createdAt !== "")
                        writer.uint32(/* id 13, wireType 2 =*/106).string(message.createdAt);
                    if (message.clientId != null && $Object.hasOwnProperty.call(message, "clientId") && message.clientId !== "")
                        writer.uint32(/* id 14, wireType 2 =*/114).string(message.clientId);
                    if (message.sequence != null && $Object.hasOwnProperty.call(message, "sequence") && (typeof message.sequence === "object" ? message.sequence.low || message.sequence.high : message.sequence !== 0))
                        writer.uint32(/* id 15, wireType 0 =*/120).uint64(message.sequence);
                    if (message.actorName != null && $Object.hasOwnProperty.call(message, "actorName") && message.actorName !== "")
                        writer.uint32(/* id 16, wireType 2 =*/130).string(message.actorName);
                    if (message.threadTitle != null && $Object.hasOwnProperty.call(message, "threadTitle") && message.threadTitle !== "")
                        writer.uint32(/* id 17, wireType 2 =*/138).string(message.threadTitle);
                    if (message.$unknowns != null && $Object.hasOwnProperty.call(message, "$unknowns"))
                        for (let i = 0; i < message.$unknowns.length; ++i)
                            writer.raw(message.$unknowns[i]);
                    return writer;
                };

                /**
                 * Encodes the specified DiscussionEvent message, length delimited. Does not implicitly {@link one.discussion.v1.DiscussionEvent.verify|verify} messages.
                 * @function encodeDelimited
                 * @memberof one.discussion.v1.DiscussionEvent
                 * @static
                 * @param {one.discussion.v1.DiscussionEvent.$Properties} message DiscussionEvent message or plain object to encode
                 * @param {$protobuf.Writer} [writer] Writer to encode to
                 * @returns {$protobuf.Writer} Writer
                 */
                DiscussionEvent.encodeDelimited = function(message, writer) {
                    return this.encode(message, (writer || $Writer.create()).fork()).ldelim();
                };

                /**
                 * Decodes a DiscussionEvent message from the specified reader or buffer.
                 * @function decode
                 * @memberof one.discussion.v1.DiscussionEvent
                 * @static
                 * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
                 * @param {number} [length] Message length if known beforehand
                 * @returns {one.discussion.v1.DiscussionEvent & one.discussion.v1.DiscussionEvent.$Shape} DiscussionEvent
                 * @throws {Error} If the payload is not a reader or valid buffer
                 * @throws {$protobuf.util.ProtocolError} If required fields are missing
                 */
                DiscussionEvent.decode = function (reader, length, _end, _depth, _target) {
                    if (!(reader instanceof $Reader))
                        reader = $Reader.create(reader);
                    if (_depth === $undefined)
                        _depth = 0;
                    if (_depth > $Reader.recursionLimit)
                        throw $Error("max depth exceeded");
                    let end, message, value;
                    if (length === $undefined)
                        end = reader.len;
                    else {
                        end = reader.pos + length;
                        if (end > reader.len)
                            throw $RangeError("index out of range");
                        length = reader.len;
                        reader.len = end;
                    }
                    message = _target || new $root.one.discussion.v1.DiscussionEvent();
                    while (reader.pos < end) {
                        let start = reader.pos;
                        let tag = reader.tag();
                        if (tag === _end) {
                            _end = $undefined;
                            break;
                        }
                        let wireType = tag & 7;
                        switch (tag >>>= 3) {
                        case 1: {
                                if (wireType !== 0)
                                    break;
                                if (value = reader.uint32())
                                    message.version = value;
                                else
                                    delete message.version;
                                continue;
                            }
                        case 2: {
                                if (wireType !== 2)
                                    break;
                                if ((value = reader.stringVerify()).length)
                                    message.id = value;
                                else
                                    delete message.id;
                                continue;
                            }
                        case 3: {
                                if (wireType !== 2)
                                    break;
                                if ((value = reader.stringVerify()).length)
                                    message.thread = value;
                                else
                                    delete message.thread;
                                continue;
                            }
                        case 4: {
                                if (wireType !== 2)
                                    break;
                                if ((value = reader.stringVerify()).length)
                                    message.actor = value;
                                else
                                    delete message.actor;
                                continue;
                            }
                        case 5: {
                                if (wireType !== 0)
                                    break;
                                if (value = reader.int32())
                                    message.kind = value;
                                else
                                    delete message.kind;
                                continue;
                            }
                        case 6: {
                                if (wireType !== 2)
                                    break;
                                if ((value = reader.stringVerify()).length)
                                    message.text = value;
                                else
                                    delete message.text;
                                continue;
                            }
                        case 7: {
                                if (wireType !== 2)
                                    break;
                                if ((value = reader.stringVerify()).length)
                                    message.ref = value;
                                else
                                    delete message.ref;
                                continue;
                            }
                        case 8: {
                                if (wireType !== 2)
                                    break;
                                if (!(message.evidenceRefs && message.evidenceRefs.length))
                                    message.evidenceRefs = [];
                                message.evidenceRefs.push(reader.stringVerify());
                                continue;
                            }
                        case 9: {
                                if (wireType !== 2)
                                    break;
                                if (!(message.artifactRefs && message.artifactRefs.length))
                                    message.artifactRefs = [];
                                message.artifactRefs.push(reader.stringVerify());
                                continue;
                            }
                        case 10: {
                                if (wireType !== 2)
                                    break;
                                if ((value = reader.stringVerify()).length)
                                    message.scope = value;
                                else
                                    delete message.scope;
                                continue;
                            }
                        case 11: {
                                if (wireType !== 2)
                                    break;
                                if ((value = reader.stringVerify()).length)
                                    message.deadline = value;
                                else
                                    delete message.deadline;
                                continue;
                            }
                        case 12: {
                                if (wireType !== 2)
                                    break;
                                if ((value = reader.stringVerify()).length)
                                    message.stance = value;
                                else
                                    delete message.stance;
                                continue;
                            }
                        case 13: {
                                if (wireType !== 2)
                                    break;
                                if ((value = reader.stringVerify()).length)
                                    message.createdAt = value;
                                else
                                    delete message.createdAt;
                                continue;
                            }
                        case 14: {
                                if (wireType !== 2)
                                    break;
                                if ((value = reader.stringVerify()).length)
                                    message.clientId = value;
                                else
                                    delete message.clientId;
                                continue;
                            }
                        case 15: {
                                if (wireType !== 0)
                                    break;
                                if (typeof (value = reader.uint64()) === "object" ? value.low || value.high : value !== 0)
                                    message.sequence = value;
                                else
                                    delete message.sequence;
                                continue;
                            }
                        case 16: {
                                if (wireType !== 2)
                                    break;
                                if ((value = reader.stringVerify()).length)
                                    message.actorName = value;
                                else
                                    delete message.actorName;
                                continue;
                            }
                        case 17: {
                                if (wireType !== 2)
                                    break;
                                if ((value = reader.stringVerify()).length)
                                    message.threadTitle = value;
                                else
                                    delete message.threadTitle;
                                continue;
                            }
                        }
                        reader.skipType(wireType, _depth, tag);
                        if (!reader.discardUnknown) {
                            $util.makeProp(message, "$unknowns", false);
                            (message.$unknowns || (message.$unknowns = [])).push(reader.raw(start, reader.pos));
                        }
                    }
                    if (length !== $undefined) {
                        if (reader.pos !== end)
                            throw $RangeError("index out of range");
                        reader.len = length;
                    }
                    if (_end !== $undefined)
                        throw $Error("missing end group");
                    return message;
                };

                /**
                 * Decodes a DiscussionEvent message from the specified reader or buffer, length delimited.
                 * @function decodeDelimited
                 * @memberof one.discussion.v1.DiscussionEvent
                 * @static
                 * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
                 * @returns {one.discussion.v1.DiscussionEvent & one.discussion.v1.DiscussionEvent.$Shape} DiscussionEvent
                 * @throws {Error} If the payload is not a reader or valid buffer
                 * @throws {$protobuf.util.ProtocolError} If required fields are missing
                 */
                DiscussionEvent.decodeDelimited = function(reader) {
                    if (!(reader instanceof $Reader))
                        reader = new $Reader(reader);
                    return this.decode(reader, reader.uint32());
                };

                /**
                 * Verifies a DiscussionEvent message.
                 * @function verify
                 * @memberof one.discussion.v1.DiscussionEvent
                 * @static
                 * @param {Object.<string,*>} message Plain object to verify
                 * @returns {string|null} `null` if valid, otherwise the reason why it is not
                 */
                DiscussionEvent.verify = function (message, _depth) {
                    if (typeof message !== "object" || message === null)
                        return "object expected";
                    if (_depth === $undefined)
                        _depth = 0;
                    if (_depth > $util.recursionLimit)
                        return "max depth exceeded";
                    if (message.version != null && $Object.hasOwnProperty.call(message, "version"))
                        if (!$util.isInteger(message.version))
                            return "version: integer expected";
                    if (message.id != null && $Object.hasOwnProperty.call(message, "id"))
                        if (!$util.isString(message.id))
                            return "id: string expected";
                    if (message.thread != null && $Object.hasOwnProperty.call(message, "thread"))
                        if (!$util.isString(message.thread))
                            return "thread: string expected";
                    if (message.actor != null && $Object.hasOwnProperty.call(message, "actor"))
                        if (!$util.isString(message.actor))
                            return "actor: string expected";
                    if (message.kind != null && $Object.hasOwnProperty.call(message, "kind"))
                        if (typeof message.kind !== "number" || (message.kind | 0) !== message.kind)
                            return "kind: enum value expected";
                    if (message.text != null && $Object.hasOwnProperty.call(message, "text"))
                        if (!$util.isString(message.text))
                            return "text: string expected";
                    if (message.ref != null && $Object.hasOwnProperty.call(message, "ref"))
                        if (!$util.isString(message.ref))
                            return "ref: string expected";
                    if (message.evidenceRefs != null && $Object.hasOwnProperty.call(message, "evidenceRefs")) {
                        if (!$Array.isArray(message.evidenceRefs))
                            return "evidenceRefs: array expected";
                        for (let i = 0; i < message.evidenceRefs.length; ++i)
                            if (!$util.isString(message.evidenceRefs[i]))
                                return "evidenceRefs: string[] expected";
                    }
                    if (message.artifactRefs != null && $Object.hasOwnProperty.call(message, "artifactRefs")) {
                        if (!$Array.isArray(message.artifactRefs))
                            return "artifactRefs: array expected";
                        for (let i = 0; i < message.artifactRefs.length; ++i)
                            if (!$util.isString(message.artifactRefs[i]))
                                return "artifactRefs: string[] expected";
                    }
                    if (message.scope != null && $Object.hasOwnProperty.call(message, "scope"))
                        if (!$util.isString(message.scope))
                            return "scope: string expected";
                    if (message.deadline != null && $Object.hasOwnProperty.call(message, "deadline"))
                        if (!$util.isString(message.deadline))
                            return "deadline: string expected";
                    if (message.stance != null && $Object.hasOwnProperty.call(message, "stance"))
                        if (!$util.isString(message.stance))
                            return "stance: string expected";
                    if (message.createdAt != null && $Object.hasOwnProperty.call(message, "createdAt"))
                        if (!$util.isString(message.createdAt))
                            return "createdAt: string expected";
                    if (message.clientId != null && $Object.hasOwnProperty.call(message, "clientId"))
                        if (!$util.isString(message.clientId))
                            return "clientId: string expected";
                    if (message.sequence != null && $Object.hasOwnProperty.call(message, "sequence"))
                        if (!$util.isInteger(message.sequence) && !(message.sequence && $util.isInteger(message.sequence.low) && $util.isInteger(message.sequence.high)))
                            return "sequence: integer|Long expected";
                    if (message.actorName != null && $Object.hasOwnProperty.call(message, "actorName"))
                        if (!$util.isString(message.actorName))
                            return "actorName: string expected";
                    if (message.threadTitle != null && $Object.hasOwnProperty.call(message, "threadTitle"))
                        if (!$util.isString(message.threadTitle))
                            return "threadTitle: string expected";
                    return null;
                };

                /**
                 * Creates a DiscussionEvent message from a plain object. Also converts values to their respective internal types.
                 * @function fromObject
                 * @memberof one.discussion.v1.DiscussionEvent
                 * @static
                 * @param {Object.<string,*>} object Plain object
                 * @returns {one.discussion.v1.DiscussionEvent} DiscussionEvent
                 */
                DiscussionEvent.fromObject = function (object, _depth) {
                    if (object instanceof $root.one.discussion.v1.DiscussionEvent)
                        return object;
                    if (!$util.isObject(object))
                        throw $TypeError(".one.discussion.v1.DiscussionEvent: object expected");
                    if (_depth === $undefined)
                        _depth = 0;
                    if (_depth > $util.recursionLimit)
                        throw $Error("max depth exceeded");
                    let message = new $root.one.discussion.v1.DiscussionEvent();
                    if (object.version != null)
                        if ($Number(object.version) !== 0)
                            message.version = object.version >>> 0;
                    if (object.id != null)
                        if (typeof object.id !== "string" || object.id.length)
                            message.id = $String(object.id);
                    if (object.thread != null)
                        if (typeof object.thread !== "string" || object.thread.length)
                            message.thread = $String(object.thread);
                    if (object.actor != null)
                        if (typeof object.actor !== "string" || object.actor.length)
                            message.actor = $String(object.actor);
                    if (object.kind !== 0 && (typeof object.kind !== "string" || $root.one.discussion.v1.Kind[object.kind] !== 0))
                        switch (object.kind) {
                        case "UNSPECIFIED":
                        case 0:
                            message.kind = 0;
                            break;
                        case "NOTE":
                        case 1:
                            message.kind = 1;
                            break;
                        case "QUESTION":
                        case 2:
                            message.kind = 2;
                            break;
                        case "PROPOSAL":
                        case 3:
                            message.kind = 3;
                            break;
                        case "CLAIM":
                        case 4:
                            message.kind = 4;
                            break;
                        case "EVIDENCE":
                        case 5:
                            message.kind = 5;
                            break;
                        case "OBJECTION":
                        case 6:
                            message.kind = 6;
                            break;
                        case "COMMITMENT":
                        case 7:
                            message.kind = 7;
                            break;
                        case "VOTE":
                        case 8:
                            message.kind = 8;
                            break;
                        case "RESOLUTION":
                        case 9:
                            message.kind = 9;
                            break;
                        default:
                            if (typeof object.kind === "number" && (object.kind | 0) === object.kind)
                                message.kind = object.kind;
                        }
                    if (object.text != null)
                        if (typeof object.text !== "string" || object.text.length)
                            message.text = $String(object.text);
                    if (object.ref != null)
                        if (typeof object.ref !== "string" || object.ref.length)
                            message.ref = $String(object.ref);
                    if (object.evidenceRefs) {
                        if (!$Array.isArray(object.evidenceRefs))
                            throw $TypeError(".one.discussion.v1.DiscussionEvent.evidenceRefs: array expected");
                        message.evidenceRefs = $Array(object.evidenceRefs.length);
                        for (let i = 0; i < object.evidenceRefs.length; ++i)
                            message.evidenceRefs[i] = $String(object.evidenceRefs[i]);
                    }
                    if (object.artifactRefs) {
                        if (!$Array.isArray(object.artifactRefs))
                            throw $TypeError(".one.discussion.v1.DiscussionEvent.artifactRefs: array expected");
                        message.artifactRefs = $Array(object.artifactRefs.length);
                        for (let i = 0; i < object.artifactRefs.length; ++i)
                            message.artifactRefs[i] = $String(object.artifactRefs[i]);
                    }
                    if (object.scope != null)
                        if (typeof object.scope !== "string" || object.scope.length)
                            message.scope = $String(object.scope);
                    if (object.deadline != null)
                        if (typeof object.deadline !== "string" || object.deadline.length)
                            message.deadline = $String(object.deadline);
                    if (object.stance != null)
                        if (typeof object.stance !== "string" || object.stance.length)
                            message.stance = $String(object.stance);
                    if (object.createdAt != null)
                        if (typeof object.createdAt !== "string" || object.createdAt.length)
                            message.createdAt = $String(object.createdAt);
                    if (object.clientId != null)
                        if (typeof object.clientId !== "string" || object.clientId.length)
                            message.clientId = $String(object.clientId);
                    if (object.sequence != null)
                        if (typeof object.sequence === "object" ? object.sequence.low || object.sequence.high : $Number(object.sequence) !== 0)
                            if ($util.Long)
                                message.sequence = $util.Long.fromValue(object.sequence, true);
                            else if (typeof object.sequence === "string")
                                message.sequence = $parseInt(object.sequence, 10);
                            else if (typeof object.sequence === "number")
                                message.sequence = object.sequence;
                            else if (typeof object.sequence === "object")
                                message.sequence = new $util.LongBits(object.sequence.low >>> 0, object.sequence.high >>> 0).toNumber(true);
                    if (object.actorName != null)
                        if (typeof object.actorName !== "string" || object.actorName.length)
                            message.actorName = $String(object.actorName);
                    if (object.threadTitle != null)
                        if (typeof object.threadTitle !== "string" || object.threadTitle.length)
                            message.threadTitle = $String(object.threadTitle);
                    return message;
                };

                /**
                 * Creates a plain object from a DiscussionEvent message. Also converts values to other types if specified.
                 * @function toObject
                 * @memberof one.discussion.v1.DiscussionEvent
                 * @static
                 * @param {one.discussion.v1.DiscussionEvent} message DiscussionEvent
                 * @param {$protobuf.IConversionOptions} [options] Conversion options
                 * @returns {Object.<string,*>} Plain object
                 */
                DiscussionEvent.toObject = function (message, options, _depth) {
                    if (!options)
                        options = {};
                    if (_depth === $undefined)
                        _depth = 0;
                    if (_depth > $util.recursionLimit)
                        throw $Error("max depth exceeded");
                    let object = {};
                    if (options.arrays || options.defaults) {
                        object.evidenceRefs = [];
                        object.artifactRefs = [];
                    }
                    if (options.defaults) {
                        object.version = 0;
                        object.id = "";
                        object.thread = "";
                        object.actor = "";
                        object.kind = options.enums === $String ? "UNSPECIFIED" : 0;
                        object.text = "";
                        object.ref = "";
                        object.scope = "";
                        object.deadline = "";
                        object.stance = "";
                        object.createdAt = "";
                        object.clientId = "";
                        if ($util.Long) {
                            let long = new $util.Long(0, 0, true);
                            object.sequence = options.longs === $String ? long.toString() : options.longs === $Number ? long.toNumber() : typeof $BigInt !== "undefined" && options.longs === $BigInt ? long.toBigInt() : long;
                        } else
                            object.sequence = options.longs === $String ? "0" : typeof $BigInt !== "undefined" && options.longs === $BigInt ? $BigInt("0") : 0;
                        object.actorName = "";
                        object.threadTitle = "";
                    }
                    if (message.version != null && $Object.hasOwnProperty.call(message, "version"))
                        object.version = message.version;
                    if (message.id != null && $Object.hasOwnProperty.call(message, "id"))
                        object.id = message.id;
                    if (message.thread != null && $Object.hasOwnProperty.call(message, "thread"))
                        object.thread = message.thread;
                    if (message.actor != null && $Object.hasOwnProperty.call(message, "actor"))
                        object.actor = message.actor;
                    if (message.kind != null && $Object.hasOwnProperty.call(message, "kind"))
                        object.kind = options.enums === $String ? $root.one.discussion.v1.Kind[message.kind] === $undefined ? message.kind : $root.one.discussion.v1.Kind[message.kind] : message.kind;
                    if (message.text != null && $Object.hasOwnProperty.call(message, "text"))
                        object.text = message.text;
                    if (message.ref != null && $Object.hasOwnProperty.call(message, "ref"))
                        object.ref = message.ref;
                    if (message.evidenceRefs && message.evidenceRefs.length) {
                        object.evidenceRefs = $Array(message.evidenceRefs.length);
                        for (let j = 0; j < message.evidenceRefs.length; ++j)
                            object.evidenceRefs[j] = message.evidenceRefs[j];
                    }
                    if (message.artifactRefs && message.artifactRefs.length) {
                        object.artifactRefs = $Array(message.artifactRefs.length);
                        for (let j = 0; j < message.artifactRefs.length; ++j)
                            object.artifactRefs[j] = message.artifactRefs[j];
                    }
                    if (message.scope != null && $Object.hasOwnProperty.call(message, "scope"))
                        object.scope = message.scope;
                    if (message.deadline != null && $Object.hasOwnProperty.call(message, "deadline"))
                        object.deadline = message.deadline;
                    if (message.stance != null && $Object.hasOwnProperty.call(message, "stance"))
                        object.stance = message.stance;
                    if (message.createdAt != null && $Object.hasOwnProperty.call(message, "createdAt"))
                        object.createdAt = message.createdAt;
                    if (message.clientId != null && $Object.hasOwnProperty.call(message, "clientId"))
                        object.clientId = message.clientId;
                    if (message.sequence != null && $Object.hasOwnProperty.call(message, "sequence"))
                        if (typeof $BigInt !== "undefined" && options.longs === $BigInt)
                            object.sequence = typeof message.sequence === "number" ? $BigInt(message.sequence) : $util.Long.fromBits(message.sequence.low >>> 0, message.sequence.high >>> 0, true).toBigInt();
                        else if (typeof message.sequence === "number")
                            object.sequence = options.longs === $String ? $String(message.sequence) : message.sequence;
                        else
                            object.sequence = options.longs === $String ? $util.Long.prototype.toString.call(message.sequence) : options.longs === $Number ? new $util.LongBits(message.sequence.low >>> 0, message.sequence.high >>> 0).toNumber(true) : message.sequence;
                    if (message.actorName != null && $Object.hasOwnProperty.call(message, "actorName"))
                        object.actorName = message.actorName;
                    if (message.threadTitle != null && $Object.hasOwnProperty.call(message, "threadTitle"))
                        object.threadTitle = message.threadTitle;
                    return object;
                };

                /**
                 * Converts this DiscussionEvent to JSON.
                 * @function toJSON
                 * @memberof one.discussion.v1.DiscussionEvent
                 * @instance
                 * @returns {Object.<string,*>} JSON object
                 */
                DiscussionEvent.prototype.toJSON = function() {
                    return DiscussionEvent.toObject(this, $protobuf.util.toJSONOptions);
                };

                /**
                 * Gets the type url for DiscussionEvent
                 * @function getTypeUrl
                 * @memberof one.discussion.v1.DiscussionEvent
                 * @static
                 * @param {string} [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
                 * @returns {string} The type url
                 */
                DiscussionEvent.getTypeUrl = function(prefix) {
                    if (prefix === $undefined)
                        prefix = "type.googleapis.com";
                    return prefix + "/one.discussion.v1.DiscussionEvent";
                };

                return DiscussionEvent;
            })();

            v1.Frame = (function() {

                /**
                 * Properties of a Frame.
                 * @typedef {Object} one.discussion.v1.Frame.$Properties
                 * @property {number|null} [version] Frame version
                 * @property {one.discussion.v1.Signal|null} [signal] Frame signal
                 * @property {number|Long|null} [revision] Frame revision
                 * @property {Array.<one.discussion.v1.DiscussionEvent.$Properties>|null} [events] Frame events
                 * @property {number|Long|null} [cursor] Frame cursor
                 * @property {boolean|null} [hasMore] Frame hasMore
                 * @property {string|null} [channel] Frame channel
                 * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding when enabled
                 */

                /**
                 * Properties of a Frame.
                 * @memberof one.discussion.v1
                 * @interface IFrame
                 * @augments one.discussion.v1.Frame.$Properties
                 * @deprecated Use one.discussion.v1.Frame.$Properties instead.
                 */

                /**
                 * Shape of a Frame.
                 * @typedef {one.discussion.v1.Frame.$Properties} one.discussion.v1.Frame.$Shape
                 */

                /**
                 * Constructs a new Frame.
                 * @memberof one.discussion.v1
                 * @classdesc Represents a Frame.
                 * @constructor
                 * @param {one.discussion.v1.Frame.$Properties=} [properties] Properties to set
                 * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding when enabled
                 */
                const Frame = function (properties) {
                    this.events = [];
                    if (properties)
                        for (let keys = $Object.keys(properties), i = 0; i < keys.length; ++i)
                            if (properties[keys[i]] != null && keys[i] !== "__proto__")
                                this[keys[i]] = properties[keys[i]];
                };

                /**
                 * Frame version.
                 * @member {number} version
                 * @memberof one.discussion.v1.Frame
                 * @instance
                 */
                Frame.prototype.version = 0;

                /**
                 * Frame signal.
                 * @member {one.discussion.v1.Signal} signal
                 * @memberof one.discussion.v1.Frame
                 * @instance
                 */
                Frame.prototype.signal = 0;

                /**
                 * Frame revision.
                 * @member {number|Long} revision
                 * @memberof one.discussion.v1.Frame
                 * @instance
                 */
                Frame.prototype.revision = $util.Long ? $util.Long.fromBits(0,0,true) : 0;

                /**
                 * Frame events.
                 * @member {Array.<one.discussion.v1.DiscussionEvent.$Properties>} events
                 * @memberof one.discussion.v1.Frame
                 * @instance
                 */
                Frame.prototype.events = $util.emptyArray;

                /**
                 * Frame cursor.
                 * @member {number|Long} cursor
                 * @memberof one.discussion.v1.Frame
                 * @instance
                 */
                Frame.prototype.cursor = $util.Long ? $util.Long.fromBits(0,0,true) : 0;

                /**
                 * Frame hasMore.
                 * @member {boolean} hasMore
                 * @memberof one.discussion.v1.Frame
                 * @instance
                 */
                Frame.prototype.hasMore = false;

                /**
                 * Frame channel.
                 * @member {string} channel
                 * @memberof one.discussion.v1.Frame
                 * @instance
                 */
                Frame.prototype.channel = "";

                /**
                 * Creates a new Frame instance using the specified properties.
                 * @function create
                 * @memberof one.discussion.v1.Frame
                 * @static
                 * @param {one.discussion.v1.Frame.$Properties=} [properties] Properties to set
                 * @returns {one.discussion.v1.Frame} Frame instance
                 * @type {{
                 *   (properties: one.discussion.v1.Frame.$Shape): one.discussion.v1.Frame & one.discussion.v1.Frame.$Shape;
                 *   (properties?: one.discussion.v1.Frame.$Properties): one.discussion.v1.Frame;
                 * }}
                 */
                Frame.create = function(properties) {
                    return new Frame(properties);
                };

                /**
                 * Encodes the specified Frame message. Does not implicitly {@link one.discussion.v1.Frame.verify|verify} messages.
                 * @function encode
                 * @memberof one.discussion.v1.Frame
                 * @static
                 * @param {one.discussion.v1.Frame.$Properties} message Frame message or plain object to encode
                 * @param {$protobuf.Writer} [writer] Writer to encode to
                 * @returns {$protobuf.Writer} Writer
                 */
                Frame.encode = function (message, writer, _depth) {
                    if (!writer)
                        writer = $Writer.create();
                    if (_depth === $undefined)
                        _depth = 0;
                    if (_depth > $util.recursionLimit)
                        throw $Error("max depth exceeded");
                    if (message.version != null && $Object.hasOwnProperty.call(message, "version") && message.version !== 0)
                        writer.uint32(/* id 1, wireType 0 =*/8).uint32(message.version);
                    if (message.signal != null && $Object.hasOwnProperty.call(message, "signal") && message.signal !== 0)
                        writer.uint32(/* id 2, wireType 0 =*/16).int32(message.signal);
                    if (message.revision != null && $Object.hasOwnProperty.call(message, "revision") && (typeof message.revision === "object" ? message.revision.low || message.revision.high : message.revision !== 0))
                        writer.uint32(/* id 3, wireType 0 =*/24).uint64(message.revision);
                    if (message.events != null && message.events.length)
                        for (let i = 0; i < message.events.length; ++i)
                            $root.one.discussion.v1.DiscussionEvent.encode(message.events[i], writer.uint32(/* id 4, wireType 2 =*/34).fork(), _depth + 1).ldelim();
                    if (message.cursor != null && $Object.hasOwnProperty.call(message, "cursor") && (typeof message.cursor === "object" ? message.cursor.low || message.cursor.high : message.cursor !== 0))
                        writer.uint32(/* id 5, wireType 0 =*/40).uint64(message.cursor);
                    if (message.hasMore != null && $Object.hasOwnProperty.call(message, "hasMore") && message.hasMore !== false)
                        writer.uint32(/* id 6, wireType 0 =*/48).bool(message.hasMore);
                    if (message.channel != null && $Object.hasOwnProperty.call(message, "channel") && message.channel !== "")
                        writer.uint32(/* id 7, wireType 2 =*/58).string(message.channel);
                    if (message.$unknowns != null && $Object.hasOwnProperty.call(message, "$unknowns"))
                        for (let i = 0; i < message.$unknowns.length; ++i)
                            writer.raw(message.$unknowns[i]);
                    return writer;
                };

                /**
                 * Encodes the specified Frame message, length delimited. Does not implicitly {@link one.discussion.v1.Frame.verify|verify} messages.
                 * @function encodeDelimited
                 * @memberof one.discussion.v1.Frame
                 * @static
                 * @param {one.discussion.v1.Frame.$Properties} message Frame message or plain object to encode
                 * @param {$protobuf.Writer} [writer] Writer to encode to
                 * @returns {$protobuf.Writer} Writer
                 */
                Frame.encodeDelimited = function(message, writer) {
                    return this.encode(message, (writer || $Writer.create()).fork()).ldelim();
                };

                /**
                 * Decodes a Frame message from the specified reader or buffer.
                 * @function decode
                 * @memberof one.discussion.v1.Frame
                 * @static
                 * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
                 * @param {number} [length] Message length if known beforehand
                 * @returns {one.discussion.v1.Frame & one.discussion.v1.Frame.$Shape} Frame
                 * @throws {Error} If the payload is not a reader or valid buffer
                 * @throws {$protobuf.util.ProtocolError} If required fields are missing
                 */
                Frame.decode = function (reader, length, _end, _depth, _target) {
                    if (!(reader instanceof $Reader))
                        reader = $Reader.create(reader);
                    if (_depth === $undefined)
                        _depth = 0;
                    if (_depth > $Reader.recursionLimit)
                        throw $Error("max depth exceeded");
                    let end, message, value;
                    if (length === $undefined)
                        end = reader.len;
                    else {
                        end = reader.pos + length;
                        if (end > reader.len)
                            throw $RangeError("index out of range");
                        length = reader.len;
                        reader.len = end;
                    }
                    message = _target || new $root.one.discussion.v1.Frame();
                    while (reader.pos < end) {
                        let start = reader.pos;
                        let tag = reader.tag();
                        if (tag === _end) {
                            _end = $undefined;
                            break;
                        }
                        let wireType = tag & 7;
                        switch (tag >>>= 3) {
                        case 1: {
                                if (wireType !== 0)
                                    break;
                                if (value = reader.uint32())
                                    message.version = value;
                                else
                                    delete message.version;
                                continue;
                            }
                        case 2: {
                                if (wireType !== 0)
                                    break;
                                if (value = reader.int32())
                                    message.signal = value;
                                else
                                    delete message.signal;
                                continue;
                            }
                        case 3: {
                                if (wireType !== 0)
                                    break;
                                if (typeof (value = reader.uint64()) === "object" ? value.low || value.high : value !== 0)
                                    message.revision = value;
                                else
                                    delete message.revision;
                                continue;
                            }
                        case 4: {
                                if (wireType !== 2)
                                    break;
                                if (!(message.events && message.events.length))
                                    message.events = [];
                                message.events.push($root.one.discussion.v1.DiscussionEvent.decode(reader, reader.uint32(), $undefined, _depth + 1));
                                continue;
                            }
                        case 5: {
                                if (wireType !== 0)
                                    break;
                                if (typeof (value = reader.uint64()) === "object" ? value.low || value.high : value !== 0)
                                    message.cursor = value;
                                else
                                    delete message.cursor;
                                continue;
                            }
                        case 6: {
                                if (wireType !== 0)
                                    break;
                                if (value = reader.bool())
                                    message.hasMore = value;
                                else
                                    delete message.hasMore;
                                continue;
                            }
                        case 7: {
                                if (wireType !== 2)
                                    break;
                                if ((value = reader.stringVerify()).length)
                                    message.channel = value;
                                else
                                    delete message.channel;
                                continue;
                            }
                        }
                        reader.skipType(wireType, _depth, tag);
                        if (!reader.discardUnknown) {
                            $util.makeProp(message, "$unknowns", false);
                            (message.$unknowns || (message.$unknowns = [])).push(reader.raw(start, reader.pos));
                        }
                    }
                    if (length !== $undefined) {
                        if (reader.pos !== end)
                            throw $RangeError("index out of range");
                        reader.len = length;
                    }
                    if (_end !== $undefined)
                        throw $Error("missing end group");
                    return message;
                };

                /**
                 * Decodes a Frame message from the specified reader or buffer, length delimited.
                 * @function decodeDelimited
                 * @memberof one.discussion.v1.Frame
                 * @static
                 * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
                 * @returns {one.discussion.v1.Frame & one.discussion.v1.Frame.$Shape} Frame
                 * @throws {Error} If the payload is not a reader or valid buffer
                 * @throws {$protobuf.util.ProtocolError} If required fields are missing
                 */
                Frame.decodeDelimited = function(reader) {
                    if (!(reader instanceof $Reader))
                        reader = new $Reader(reader);
                    return this.decode(reader, reader.uint32());
                };

                /**
                 * Verifies a Frame message.
                 * @function verify
                 * @memberof one.discussion.v1.Frame
                 * @static
                 * @param {Object.<string,*>} message Plain object to verify
                 * @returns {string|null} `null` if valid, otherwise the reason why it is not
                 */
                Frame.verify = function (message, _depth) {
                    if (typeof message !== "object" || message === null)
                        return "object expected";
                    if (_depth === $undefined)
                        _depth = 0;
                    if (_depth > $util.recursionLimit)
                        return "max depth exceeded";
                    if (message.version != null && $Object.hasOwnProperty.call(message, "version"))
                        if (!$util.isInteger(message.version))
                            return "version: integer expected";
                    if (message.signal != null && $Object.hasOwnProperty.call(message, "signal"))
                        if (typeof message.signal !== "number" || (message.signal | 0) !== message.signal)
                            return "signal: enum value expected";
                    if (message.revision != null && $Object.hasOwnProperty.call(message, "revision"))
                        if (!$util.isInteger(message.revision) && !(message.revision && $util.isInteger(message.revision.low) && $util.isInteger(message.revision.high)))
                            return "revision: integer|Long expected";
                    if (message.events != null && $Object.hasOwnProperty.call(message, "events")) {
                        if (!$Array.isArray(message.events))
                            return "events: array expected";
                        for (let i = 0; i < message.events.length; ++i) {
                            let error = $root.one.discussion.v1.DiscussionEvent.verify(message.events[i], _depth + 1);
                            if (error)
                                return "events." + error;
                        }
                    }
                    if (message.cursor != null && $Object.hasOwnProperty.call(message, "cursor"))
                        if (!$util.isInteger(message.cursor) && !(message.cursor && $util.isInteger(message.cursor.low) && $util.isInteger(message.cursor.high)))
                            return "cursor: integer|Long expected";
                    if (message.hasMore != null && $Object.hasOwnProperty.call(message, "hasMore"))
                        if (typeof message.hasMore !== "boolean")
                            return "hasMore: boolean expected";
                    if (message.channel != null && $Object.hasOwnProperty.call(message, "channel"))
                        if (!$util.isString(message.channel))
                            return "channel: string expected";
                    return null;
                };

                /**
                 * Creates a Frame message from a plain object. Also converts values to their respective internal types.
                 * @function fromObject
                 * @memberof one.discussion.v1.Frame
                 * @static
                 * @param {Object.<string,*>} object Plain object
                 * @returns {one.discussion.v1.Frame} Frame
                 */
                Frame.fromObject = function (object, _depth) {
                    if (object instanceof $root.one.discussion.v1.Frame)
                        return object;
                    if (!$util.isObject(object))
                        throw $TypeError(".one.discussion.v1.Frame: object expected");
                    if (_depth === $undefined)
                        _depth = 0;
                    if (_depth > $util.recursionLimit)
                        throw $Error("max depth exceeded");
                    let message = new $root.one.discussion.v1.Frame();
                    if (object.version != null)
                        if ($Number(object.version) !== 0)
                            message.version = object.version >>> 0;
                    if (object.signal !== 0 && (typeof object.signal !== "string" || $root.one.discussion.v1.Signal[object.signal] !== 0))
                        switch (object.signal) {
                        case "NONE":
                        case 0:
                            message.signal = 0;
                            break;
                        case "READY":
                        case 1:
                            message.signal = 1;
                            break;
                        case "CHANGED":
                        case 2:
                            message.signal = 2;
                            break;
                        case "RESET":
                        case 3:
                            message.signal = 3;
                            break;
                        default:
                            if (typeof object.signal === "number" && (object.signal | 0) === object.signal)
                                message.signal = object.signal;
                        }
                    if (object.revision != null)
                        if (typeof object.revision === "object" ? object.revision.low || object.revision.high : $Number(object.revision) !== 0)
                            if ($util.Long)
                                message.revision = $util.Long.fromValue(object.revision, true);
                            else if (typeof object.revision === "string")
                                message.revision = $parseInt(object.revision, 10);
                            else if (typeof object.revision === "number")
                                message.revision = object.revision;
                            else if (typeof object.revision === "object")
                                message.revision = new $util.LongBits(object.revision.low >>> 0, object.revision.high >>> 0).toNumber(true);
                    if (object.events) {
                        if (!$Array.isArray(object.events))
                            throw $TypeError(".one.discussion.v1.Frame.events: array expected");
                        message.events = $Array(object.events.length);
                        for (let i = 0; i < object.events.length; ++i) {
                            if (!$util.isObject(object.events[i]))
                                throw $TypeError(".one.discussion.v1.Frame.events: object expected");
                            message.events[i] = $root.one.discussion.v1.DiscussionEvent.fromObject(object.events[i], _depth + 1);
                        }
                    }
                    if (object.cursor != null)
                        if (typeof object.cursor === "object" ? object.cursor.low || object.cursor.high : $Number(object.cursor) !== 0)
                            if ($util.Long)
                                message.cursor = $util.Long.fromValue(object.cursor, true);
                            else if (typeof object.cursor === "string")
                                message.cursor = $parseInt(object.cursor, 10);
                            else if (typeof object.cursor === "number")
                                message.cursor = object.cursor;
                            else if (typeof object.cursor === "object")
                                message.cursor = new $util.LongBits(object.cursor.low >>> 0, object.cursor.high >>> 0).toNumber(true);
                    if (object.hasMore != null)
                        if (object.hasMore)
                            message.hasMore = $Boolean(object.hasMore);
                    if (object.channel != null)
                        if (typeof object.channel !== "string" || object.channel.length)
                            message.channel = $String(object.channel);
                    return message;
                };

                /**
                 * Creates a plain object from a Frame message. Also converts values to other types if specified.
                 * @function toObject
                 * @memberof one.discussion.v1.Frame
                 * @static
                 * @param {one.discussion.v1.Frame} message Frame
                 * @param {$protobuf.IConversionOptions} [options] Conversion options
                 * @returns {Object.<string,*>} Plain object
                 */
                Frame.toObject = function (message, options, _depth) {
                    if (!options)
                        options = {};
                    if (_depth === $undefined)
                        _depth = 0;
                    if (_depth > $util.recursionLimit)
                        throw $Error("max depth exceeded");
                    let object = {};
                    if (options.arrays || options.defaults)
                        object.events = [];
                    if (options.defaults) {
                        object.version = 0;
                        object.signal = options.enums === $String ? "NONE" : 0;
                        if ($util.Long) {
                            let long = new $util.Long(0, 0, true);
                            object.revision = options.longs === $String ? long.toString() : options.longs === $Number ? long.toNumber() : typeof $BigInt !== "undefined" && options.longs === $BigInt ? long.toBigInt() : long;
                        } else
                            object.revision = options.longs === $String ? "0" : typeof $BigInt !== "undefined" && options.longs === $BigInt ? $BigInt("0") : 0;
                        if ($util.Long) {
                            let long = new $util.Long(0, 0, true);
                            object.cursor = options.longs === $String ? long.toString() : options.longs === $Number ? long.toNumber() : typeof $BigInt !== "undefined" && options.longs === $BigInt ? long.toBigInt() : long;
                        } else
                            object.cursor = options.longs === $String ? "0" : typeof $BigInt !== "undefined" && options.longs === $BigInt ? $BigInt("0") : 0;
                        object.hasMore = false;
                        object.channel = "";
                    }
                    if (message.version != null && $Object.hasOwnProperty.call(message, "version"))
                        object.version = message.version;
                    if (message.signal != null && $Object.hasOwnProperty.call(message, "signal"))
                        object.signal = options.enums === $String ? $root.one.discussion.v1.Signal[message.signal] === $undefined ? message.signal : $root.one.discussion.v1.Signal[message.signal] : message.signal;
                    if (message.revision != null && $Object.hasOwnProperty.call(message, "revision"))
                        if (typeof $BigInt !== "undefined" && options.longs === $BigInt)
                            object.revision = typeof message.revision === "number" ? $BigInt(message.revision) : $util.Long.fromBits(message.revision.low >>> 0, message.revision.high >>> 0, true).toBigInt();
                        else if (typeof message.revision === "number")
                            object.revision = options.longs === $String ? $String(message.revision) : message.revision;
                        else
                            object.revision = options.longs === $String ? $util.Long.prototype.toString.call(message.revision) : options.longs === $Number ? new $util.LongBits(message.revision.low >>> 0, message.revision.high >>> 0).toNumber(true) : message.revision;
                    if (message.events && message.events.length) {
                        object.events = $Array(message.events.length);
                        for (let j = 0; j < message.events.length; ++j)
                            object.events[j] = $root.one.discussion.v1.DiscussionEvent.toObject(message.events[j], options, _depth + 1);
                    }
                    if (message.cursor != null && $Object.hasOwnProperty.call(message, "cursor"))
                        if (typeof $BigInt !== "undefined" && options.longs === $BigInt)
                            object.cursor = typeof message.cursor === "number" ? $BigInt(message.cursor) : $util.Long.fromBits(message.cursor.low >>> 0, message.cursor.high >>> 0, true).toBigInt();
                        else if (typeof message.cursor === "number")
                            object.cursor = options.longs === $String ? $String(message.cursor) : message.cursor;
                        else
                            object.cursor = options.longs === $String ? $util.Long.prototype.toString.call(message.cursor) : options.longs === $Number ? new $util.LongBits(message.cursor.low >>> 0, message.cursor.high >>> 0).toNumber(true) : message.cursor;
                    if (message.hasMore != null && $Object.hasOwnProperty.call(message, "hasMore"))
                        object.hasMore = message.hasMore;
                    if (message.channel != null && $Object.hasOwnProperty.call(message, "channel"))
                        object.channel = message.channel;
                    return object;
                };

                /**
                 * Converts this Frame to JSON.
                 * @function toJSON
                 * @memberof one.discussion.v1.Frame
                 * @instance
                 * @returns {Object.<string,*>} JSON object
                 */
                Frame.prototype.toJSON = function() {
                    return Frame.toObject(this, $protobuf.util.toJSONOptions);
                };

                /**
                 * Gets the type url for Frame
                 * @function getTypeUrl
                 * @memberof one.discussion.v1.Frame
                 * @static
                 * @param {string} [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
                 * @returns {string} The type url
                 */
                Frame.getTypeUrl = function(prefix) {
                    if (prefix === $undefined)
                        prefix = "type.googleapis.com";
                    return prefix + "/one.discussion.v1.Frame";
                };

                return Frame;
            })();

            return v1;
        })();

        return discussion;
    })();

    return one;
})();

export {
  $root as default
};
