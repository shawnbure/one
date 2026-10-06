import * as $protobuf from "protobufjs";
import Long = require("long");

/** Namespace one. */
export namespace one {

    /** Namespace discussion. */
    namespace discussion {

        /** Namespace v1. */
        namespace v1 {

            /** Kind enum. */
            enum Kind {

                /** UNSPECIFIED value */
                UNSPECIFIED = 0,

                /** NOTE value */
                NOTE = 1,

                /** QUESTION value */
                QUESTION = 2,

                /** PROPOSAL value */
                PROPOSAL = 3,

                /** CLAIM value */
                CLAIM = 4,

                /** EVIDENCE value */
                EVIDENCE = 5,

                /** OBJECTION value */
                OBJECTION = 6,

                /** COMMITMENT value */
                COMMITMENT = 7,

                /** VOTE value */
                VOTE = 8,

                /** RESOLUTION value */
                RESOLUTION = 9
            }

            /** Signal enum. */
            enum Signal {

                /** NONE value */
                NONE = 0,

                /** READY value */
                READY = 1,

                /** CHANGED value */
                CHANGED = 2,

                /** RESET value */
                RESET = 3
            }

            /**
             * Properties of a DiscussionEvent.
             * @deprecated Use one.discussion.v1.DiscussionEvent.$Properties instead.
             */
            interface IDiscussionEvent extends one.discussion.v1.DiscussionEvent.$Properties {
            }

            /** Represents a DiscussionEvent. */
            class DiscussionEvent {

                /**
                 * Constructs a new DiscussionEvent.
                 * @param [properties] Properties to set
                 */
                constructor(properties?: one.discussion.v1.DiscussionEvent.$Properties);

                /** Unknown fields preserved while decoding when enabled */
                $unknowns?: Uint8Array[];

                /** DiscussionEvent version. */
                version: number;

                /** DiscussionEvent id. */
                id: string;

                /** DiscussionEvent thread. */
                thread: string;

                /** DiscussionEvent actor. */
                actor: string;

                /** DiscussionEvent kind. */
                kind: one.discussion.v1.Kind;

                /** DiscussionEvent text. */
                text: string;

                /** DiscussionEvent ref. */
                ref: string;

                /** DiscussionEvent evidenceRefs. */
                evidenceRefs: string[];

                /** DiscussionEvent artifactRefs. */
                artifactRefs: string[];

                /** DiscussionEvent scope. */
                scope: string;

                /** DiscussionEvent deadline. */
                deadline: string;

                /** DiscussionEvent stance. */
                stance: string;

                /** DiscussionEvent createdAt. */
                createdAt: string;

                /** DiscussionEvent clientId. */
                clientId: string;

                /** DiscussionEvent sequence. */
                sequence: (number|Long);

                /** DiscussionEvent actorName. */
                actorName: string;

                /** DiscussionEvent threadTitle. */
                threadTitle: string;

                /**
                 * Creates a new DiscussionEvent instance using the specified properties.
                 * @param [properties] Properties to set
                 * @returns DiscussionEvent instance
                 */
                static create(properties: one.discussion.v1.DiscussionEvent.$Shape): one.discussion.v1.DiscussionEvent & one.discussion.v1.DiscussionEvent.$Shape;
                static create(properties?: one.discussion.v1.DiscussionEvent.$Properties): one.discussion.v1.DiscussionEvent;

                /**
                 * Encodes the specified DiscussionEvent message. Does not implicitly {@link one.discussion.v1.DiscussionEvent.verify|verify} messages.
                 * @param message DiscussionEvent message or plain object to encode
                 * @param [writer] Writer to encode to
                 * @returns Writer
                 */
                static encode(message: one.discussion.v1.DiscussionEvent.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

                /**
                 * Encodes the specified DiscussionEvent message, length delimited. Does not implicitly {@link one.discussion.v1.DiscussionEvent.verify|verify} messages.
                 * @param message DiscussionEvent message or plain object to encode
                 * @param [writer] Writer to encode to
                 * @returns Writer
                 */
                static encodeDelimited(message: one.discussion.v1.DiscussionEvent.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

                /**
                 * Decodes a DiscussionEvent message from the specified reader or buffer.
                 * @param reader Reader or buffer to decode from
                 * @param [length] Message length if known beforehand
                 * @returns {one.discussion.v1.DiscussionEvent & one.discussion.v1.DiscussionEvent.$Shape} DiscussionEvent
                 * @throws {Error} If the payload is not a reader or valid buffer
                 * @throws {$protobuf.util.ProtocolError} If required fields are missing
                 */
                static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): one.discussion.v1.DiscussionEvent & one.discussion.v1.DiscussionEvent.$Shape;

                /**
                 * Decodes a DiscussionEvent message from the specified reader or buffer, length delimited.
                 * @param reader Reader or buffer to decode from
                 * @returns {one.discussion.v1.DiscussionEvent & one.discussion.v1.DiscussionEvent.$Shape} DiscussionEvent
                 * @throws {Error} If the payload is not a reader or valid buffer
                 * @throws {$protobuf.util.ProtocolError} If required fields are missing
                 */
                static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): one.discussion.v1.DiscussionEvent & one.discussion.v1.DiscussionEvent.$Shape;

                /**
                 * Verifies a DiscussionEvent message.
                 * @param message Plain object to verify
                 * @returns `null` if valid, otherwise the reason why it is not
                 */
                static verify(message: { [k: string]: any }): (string|null);

                /**
                 * Creates a DiscussionEvent message from a plain object. Also converts values to their respective internal types.
                 * @param object Plain object
                 * @returns DiscussionEvent
                 */
                static fromObject(object: { [k: string]: any }): one.discussion.v1.DiscussionEvent;

                /**
                 * Creates a plain object from a DiscussionEvent message. Also converts values to other types if specified.
                 * @param message DiscussionEvent
                 * @param [options] Conversion options
                 * @returns Plain object
                 */
                static toObject(message: one.discussion.v1.DiscussionEvent, options?: $protobuf.IConversionOptions): { [k: string]: any };

                /**
                 * Converts this DiscussionEvent to JSON.
                 * @returns JSON object
                 */
                toJSON(): { [k: string]: any };

                /**
                 * Gets the type url for DiscussionEvent
                 * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
                 * @returns The type url
                 */
                static getTypeUrl(prefix?: string): string;
            }

            namespace DiscussionEvent {

                /** Properties of a DiscussionEvent. */
                interface $Properties {

                    /** DiscussionEvent version */
                    version?: (number|null);

                    /** DiscussionEvent id */
                    id?: (string|null);

                    /** DiscussionEvent thread */
                    thread?: (string|null);

                    /** DiscussionEvent actor */
                    actor?: (string|null);

                    /** DiscussionEvent kind */
                    kind?: (one.discussion.v1.Kind|null);

                    /** DiscussionEvent text */
                    text?: (string|null);

                    /** DiscussionEvent ref */
                    ref?: (string|null);

                    /** DiscussionEvent evidenceRefs */
                    evidenceRefs?: (string[]|null);

                    /** DiscussionEvent artifactRefs */
                    artifactRefs?: (string[]|null);

                    /** DiscussionEvent scope */
                    scope?: (string|null);

                    /** DiscussionEvent deadline */
                    deadline?: (string|null);

                    /** DiscussionEvent stance */
                    stance?: (string|null);

                    /** DiscussionEvent createdAt */
                    createdAt?: (string|null);

                    /** DiscussionEvent clientId */
                    clientId?: (string|null);

                    /** DiscussionEvent sequence */
                    sequence?: (number|Long|null);

                    /** DiscussionEvent actorName */
                    actorName?: (string|null);

                    /** DiscussionEvent threadTitle */
                    threadTitle?: (string|null);

                    /** Unknown fields preserved while decoding when enabled */
                    $unknowns?: Uint8Array[];
                }

                /** Shape of a DiscussionEvent. */
                type $Shape = one.discussion.v1.DiscussionEvent.$Properties;
            }

            /**
             * Properties of a Frame.
             * @deprecated Use one.discussion.v1.Frame.$Properties instead.
             */
            interface IFrame extends one.discussion.v1.Frame.$Properties {
            }

            /** Represents a Frame. */
            class Frame {

                /**
                 * Constructs a new Frame.
                 * @param [properties] Properties to set
                 */
                constructor(properties?: one.discussion.v1.Frame.$Properties);

                /** Unknown fields preserved while decoding when enabled */
                $unknowns?: Uint8Array[];

                /** Frame version. */
                version: number;

                /** Frame signal. */
                signal: one.discussion.v1.Signal;

                /** Frame revision. */
                revision: (number|Long);

                /** Frame events. */
                events: one.discussion.v1.DiscussionEvent.$Properties[];

                /** Frame cursor. */
                cursor: (number|Long);

                /** Frame hasMore. */
                hasMore: boolean;

                /** Frame channel. */
                channel: string;

                /**
                 * Creates a new Frame instance using the specified properties.
                 * @param [properties] Properties to set
                 * @returns Frame instance
                 */
                static create(properties: one.discussion.v1.Frame.$Shape): one.discussion.v1.Frame & one.discussion.v1.Frame.$Shape;
                static create(properties?: one.discussion.v1.Frame.$Properties): one.discussion.v1.Frame;

                /**
                 * Encodes the specified Frame message. Does not implicitly {@link one.discussion.v1.Frame.verify|verify} messages.
                 * @param message Frame message or plain object to encode
                 * @param [writer] Writer to encode to
                 * @returns Writer
                 */
                static encode(message: one.discussion.v1.Frame.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

                /**
                 * Encodes the specified Frame message, length delimited. Does not implicitly {@link one.discussion.v1.Frame.verify|verify} messages.
                 * @param message Frame message or plain object to encode
                 * @param [writer] Writer to encode to
                 * @returns Writer
                 */
                static encodeDelimited(message: one.discussion.v1.Frame.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

                /**
                 * Decodes a Frame message from the specified reader or buffer.
                 * @param reader Reader or buffer to decode from
                 * @param [length] Message length if known beforehand
                 * @returns {one.discussion.v1.Frame & one.discussion.v1.Frame.$Shape} Frame
                 * @throws {Error} If the payload is not a reader or valid buffer
                 * @throws {$protobuf.util.ProtocolError} If required fields are missing
                 */
                static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): one.discussion.v1.Frame & one.discussion.v1.Frame.$Shape;

                /**
                 * Decodes a Frame message from the specified reader or buffer, length delimited.
                 * @param reader Reader or buffer to decode from
                 * @returns {one.discussion.v1.Frame & one.discussion.v1.Frame.$Shape} Frame
                 * @throws {Error} If the payload is not a reader or valid buffer
                 * @throws {$protobuf.util.ProtocolError} If required fields are missing
                 */
                static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): one.discussion.v1.Frame & one.discussion.v1.Frame.$Shape;

                /**
                 * Verifies a Frame message.
                 * @param message Plain object to verify
                 * @returns `null` if valid, otherwise the reason why it is not
                 */
                static verify(message: { [k: string]: any }): (string|null);

                /**
                 * Creates a Frame message from a plain object. Also converts values to their respective internal types.
                 * @param object Plain object
                 * @returns Frame
                 */
                static fromObject(object: { [k: string]: any }): one.discussion.v1.Frame;

                /**
                 * Creates a plain object from a Frame message. Also converts values to other types if specified.
                 * @param message Frame
                 * @param [options] Conversion options
                 * @returns Plain object
                 */
                static toObject(message: one.discussion.v1.Frame, options?: $protobuf.IConversionOptions): { [k: string]: any };

                /**
                 * Converts this Frame to JSON.
                 * @returns JSON object
                 */
                toJSON(): { [k: string]: any };

                /**
                 * Gets the type url for Frame
                 * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
                 * @returns The type url
                 */
                static getTypeUrl(prefix?: string): string;
            }

            namespace Frame {

                /** Properties of a Frame. */
                interface $Properties {

                    /** Frame version */
                    version?: (number|null);

                    /** Frame signal */
                    signal?: (one.discussion.v1.Signal|null);

                    /** Frame revision */
                    revision?: (number|Long|null);

                    /** Frame events */
                    events?: (one.discussion.v1.DiscussionEvent.$Properties[]|null);

                    /** Frame cursor */
                    cursor?: (number|Long|null);

                    /** Frame hasMore */
                    hasMore?: (boolean|null);

                    /** Frame channel */
                    channel?: (string|null);

                    /** Unknown fields preserved while decoding when enabled */
                    $unknowns?: Uint8Array[];
                }

                /** Shape of a Frame. */
                type $Shape = one.discussion.v1.Frame.$Properties;
            }
        }
    }
}
