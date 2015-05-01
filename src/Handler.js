/**
 * Handler控制模块
 * @module zrender/Handler
 * @author Kener (@Kener-林峰, kener.linfeng@gmail.com)
 *         errorrik (errorrik@gmail.com)
 *         pissang (shenyi.914@gmail.com)
 */
define(function (require) {

    'use strict';

    var config = require('./config');
    var env = require('./core/env');
    var eventTool = require('./core/event');
    var util = require('./core/util');
    var vec2 = require('./core/vector');
    var EVENT = config.EVENT;

    var Eventful = require('./mixin/Eventful');

    var domHandlerNames = [
        'resize', 'click', 'dblclick',
        'mousewheel', 'mousemove', 'mouseout', 'mouseup', 'mousedown',
        'touchstart', 'touchend', 'touchmove'
    ];

    // touch指尖错觉的尝试偏移量配置
    var MOBILE_TOUCH_OFFSETS = [
        { x: 10 },
        { x: -20 },
        { x: 10, y: 10 },
        { y: -20 }
    ];

    var addEventListener = eventTool.addEventListener;
    var removeEventListener = eventTool.removeEventListener;
    var normalizeEvent = eventTool.normalizeEvent;


    function proxyEventName(name) {
        return '_' + name + 'Handler';
    }

    var domHandlers = {
        /**
         * 窗口大小改变响应函数
         * @inner
         * @param {Event} event
         */
        resize: function (event) {
            event = event || window.event;
            this._lastHover = null;
            this._isMouseDown = 0;
            
            // 分发config.EVENT.RESIZE事件，global
            this.trigger(EVENT.RESIZE, event);
        },

        /**
         * 点击响应函数
         * @inner
         * @param {Event} event
         */
        click: function (event) {
            event = normalizeEvent(this.root, event);

            // 分发config.EVENT.CLICK事件
            var _lastHover = this._lastHover;
            if ((_lastHover)
                || !_lastHover
            ) {

                // 判断没有发生拖拽才触发click事件
                if (this._clickTimes < 5) {
                    this._dispatchAgency(_lastHover, EVENT.CLICK, event);
                }
            }

            this._mousemoveHandler(event);
        },
        
        /**
         * 双击响应函数
         * @inner
         * @param {Event} event
         */
        dblclick: function (event) {
            event = normalizeEvent(this.root, event);

            // 分发config.EVENT.DBLCLICK事件
            var _lastHover = this._lastHover;
            if ((_lastHover)
                || !_lastHover
            ) {

                // 判断没有发生拖拽才触发dblclick事件
                if (this._clickTimes < 5) {
                    this._dispatchAgency(_lastHover, EVENT.DBLCLICK, event);
                }
            }

            this._mousemoveHandler(event);
        },
        

        /**
         * 鼠标滚轮响应函数
         * @inner
         * @param {Event} event
         */
        mousewheel: function (event) {
            event = normalizeEvent(this.root, event);

            // 分发config.EVENT.MOUSEWHEEL事件
            this._dispatchAgency(this._lastHover, EVENT.MOUSEWHEEL, event);
            this._mousemoveHandler(event);
        },

        /**
         * 鼠标（手指）移动响应函数
         * @inner
         * @param {Event} event
         */
        mousemove: function (event) {
            event = normalizeEvent(this.root, event);

            this._lastX = this._mouseX;
            this._lastY = this._mouseY;
            this._mouseX = event.zrenderX;
            this._mouseY = event.zrenderY;
            var dx = this._mouseX - this._lastX;
            var dy = this._mouseY - this._lastY;

            // 可能出现config.EVENT.DRAGSTART事件
            // 避免手抖点击误认为拖拽
            // if (this._mouseX - this._lastX > 1 || this._mouseY - this._lastY > 1) {
            this._processDragStart(event);
            // }
            this._hasfound = 0;
            this._event = event;

            this._iterateAndFindHover();

            // 找到的在迭代函数里做了处理，没找到得在迭代完后处理
            if (!this._hasfound) {
                // 过滤首次拖拽产生的mouseout和dragLeave
                if (!this._draggingTarget
                    || (this._lastHover && this._lastHover != this._draggingTarget)
                ) {
                    // 可能出现config.EVENT.MOUSEOUT事件
                    this._processOutShape(event);

                    // 可能出现config.EVENT.DRAGLEAVE事件
                    this._processDragLeave(event);
                }

                this._lastHover = null;
            }

            // set cursor for root element
            var cursor = 'default';

            // 如果存在拖拽中元素，被拖拽的图形元素最后addHover
            var draggingTarget = this._draggingTarget;
            var lastHover = this._lastHover;
            if (draggingTarget) {
                draggingTarget.drift(dx, dy);
                // 拖拽不触发click事件
                this._clickTimes++;
            }
            else if (this._isMouseDown) {
                var needsRefresh = false;
                if (needsRefresh) {
                    this.painter.refresh();
                }
            }

            if (draggingTarget || (this._hasfound && lastHover.draggable)) {
                cursor = 'move';
            }
            else if (this._hasfound) {
                cursor = 'pointer';
            }
            this.root.style.cursor = cursor;

            // 分发config.EVENT.MOUSEMOVE事件
            this._dispatchAgency(lastHover, EVENT.MOUSEMOVE, event);
        },

        /**
         * 鼠标（手指）离开响应函数
         * @inner
         * @param {Event} event
         */
        mouseout: function (event) {
            event = normalizeEvent(this.root, event);

            var element = event.toElement || event.relatedTarget;
            if (element != this.root) {
                while (element && element.nodeType != 9) {
                    // 忽略包含在root中的dom引起的mouseOut
                    if (element == this.root) {
                        this._mousemoveHandler(event);
                        return;
                    }

                    element = element.parentNode;
                }
            }

            event.zrenderX = this._lastX;
            event.zrenderY = this._lastY;
            this.root.style.cursor = 'default';
            this._isMouseDown = 0;

            this._processOutShape(event);
            this._processDrop(event);
            this._processDragEnd(event);

            this.trigger(EVENT.GLOBALOUT, event);
        },

        /**
         * 鼠标（手指）按下响应函数
         * @inner
         * @param {Event} event
         */
        mousedown: function (event) {
            // 重置 clickThreshold
            this._clickTimes = 0;

            if (this._lastDownButton == 2) {
                this._lastDownButton = event.button;
                this._mouseDownTarget = null;
                // 仅作为关闭右键菜单使用
                return;
            }

            this._lastMouseDownMoment = new Date();
            event = normalizeEvent(this.root, event);
            this._isMouseDown = 1;

            // 分发config.EVENT.MOUSEDOWN事件
            this._mouseDownTarget = this._lastHover;
            this._dispatchAgency(this._lastHover, EVENT.MOUSEDOWN, event);
            this._lastDownButton = event.button;
        },

        /**
         * 鼠标（手指）抬起响应函数
         * @inner
         * @param {Event} event
         */
        mouseup: function (event) {
            event = normalizeEvent(this.root, event);

            this.root.style.cursor = 'default';
            this._isMouseDown = 0;
            this._mouseDownTarget = null;

            // 分发config.EVENT.MOUSEUP事件
            this._dispatchAgency(this._lastHover, EVENT.MOUSEUP, event);
            this._processDrop(event);
            this._processDragEnd(event);
        },

        /**
         * Touch开始响应函数
         * @inner
         * @param {Event} event
         */
        touchstart: function (event) {
            // eventTool.stop(event);// 阻止浏览器默认事件，重要
            event = normalizeEvent(this.root, event);

            this._lastTouchMoment = new Date();

            // 平板补充一次findHover
            this._mobileFindFixed(event);
            this._mousedownHandler(event);
        },

        /**
         * Touch移动响应函数
         * @inner
         * @param {Event} event
         */
        touchmove: function (event) {
            event = normalizeEvent(this.root, event);

            this._mousemoveHandler(event);
            if (this._isDragging) {
                eventTool.stop(event);// 阻止浏览器默认事件，重要
            }
        },

        /**
         * Touch结束响应函数
         * @inner
         * @param {Event} event
         */
        touchend: function (event) {
            // eventTool.stop(event);// 阻止浏览器默认事件，重要
            event = normalizeEvent(this.root, event);

            this._mouseupHandler(event);
            
            var now = new Date();
            if (now - this._lastTouchMoment < EVENT.touchClickDelay) {
                this._mobileFindFixed(event);
                this._clickHandler(event);
                if (now - this._lastClickMoment < EVENT.touchClickDelay / 2) {
                    this._dblclickHandler(event);
                    if (this._lastHover) {
                        eventTool.stop(event);// 阻止浏览器默认事件，重要
                    }
                }
                this._lastClickMoment = now;
            }
            this.painter.clearHover();
        }
    };

    /**
     * bind一个参数的function
     * 
     * @inner
     * @param {Function} handler 要bind的function
     * @param {Object} context 运行时this环境
     * @return {Function}
     */
    function bind1Arg(handler, context) {
        return function (e) {
            return handler.call(context, e);
        };
    }

    /**
     * 为控制类实例初始化dom 事件处理函数
     * 
     * @inner
     * @param {module:zrender/Handler} instance 控制类实例
     */
    function initDomHandler(instance) {
        var len = domHandlerNames.length;
        while (len--) {
            var name = domHandlerNames[len];
            instance[proxyEventName(name)] = bind1Arg(domHandlers[name], instance);
        }
    }

    /**
     * @alias module:zrender/Handler
     * @constructor
     * @extends module:zrender/mixin/Eventful
     * @param {HTMLElement} root 绘图区域
     * @param {module:zrender/Storage} storage Storage实例
     * @param {module:zrender/Painter} painter Painter实例
     */
    var Handler = function(root, storage, painter) {
        // 添加事件分发器特性
        Eventful.call(this);

        this.root = root;
        this.storage = storage;
        this.painter = painter;

        // 各种事件标识的私有变量
        // this._hasfound = false;              //是否找到hover图形元素
        // this._lastHover = null;              //最后一个hover图形元素
        // this._mouseDownTarget = null;
        // this._draggingTarget = null;         //当前被拖拽的图形元素
        // this._isMouseDown = false;
        // this._isDragging = false;
        // this._lastMouseDownMoment;
        // this._lastTouchMoment;
        // this._lastDownButton;

        this._lastX = 
        this._lastY = 
        this._mouseX = 
        this._mouseY = 0;

        initDomHandler(this);

        // 初始化，事件绑定，支持的所有事件都由如下原生事件计算得来
        addEventListener(window, 'resize', this._resizeHandler);

        if (env.os.tablet || env.os.phone) {
            // mobile支持
            addEventListener(root, 'touchstart', this._touchstartHandler);
            addEventListener(root, 'touchmove', this._touchmoveHandler);
            addEventListener(root, 'touchend', this._touchendHandler);

            addEventListener(root, 'mouseout', this._mouseoutHandler);
        }
        else {
            // mobile的click/move/up/down自己模拟
            for (var i = 0; i < domHandlerNames.length; i++) {
                var name = domHandlerNames[i];
                if (name.indexOf('touch') < 0) {
                    addEventListener(root, name, this[proxyEventName(name)]);
                }
            }
            // Firefox
            addEventListener(root, 'DOMMouseScroll', this._mousewheelHandler);
        }
    };

    Handler.prototype = {

        constructor: Handler,

        /**
         * 自定义事件绑定
         * @param {string} eventName 事件名称，resize，hover，drag，etc~
         * @param {Function} handler 响应函数
         * @param {Object} [context] 响应函数
         */
        on: function (eventName, handler, context) {
            this.on(eventName, handler, context);
            return this;
        },

        /**
         * 自定义事件解绑
         * @param {string} eventName 事件名称，resize，hover，drag，etc~
         * @param {Function} handler 响应函数
         */
        off: function (eventName, handler) {
            this.off(eventName, handler);
            return this;
        },

        /**
         * 事件触发
         * @param {string} eventName 事件名称，resize，hover，drag，etc~
         * @param {event=} eventArgs event dom事件对象
         */
        trigger: function (eventName, eventArgs) {
            switch (eventName) {
                case EVENT.RESIZE:
                case EVENT.CLICK:
                case EVENT.DBLCLICK:
                case EVENT.MOUSEWHEEL:
                case EVENT.MOUSEMOVE:
                case EVENT.MOUSEDOWN:
                case EVENT.MOUSEUP:
                case EVENT.MOUSEOUT:
                    this['_' + eventName + 'Handler'](eventArgs);
                    break;
            }
        },

        /**
         * 释放，解绑所有事件
         */
        dispose: function () {
            var root = this.root;

            // mobile支持
            removeEventListener(window, 'resize', this._touchstartHandler);

            for (var i = 0; i < domHandlers.length; i++) {
                var name = domHandlers[i];
                removeEventListener(root, name, this[proxyEventName(name)]);
            }

            // Firefox
            removeEventListener(root, 'DOMMouseScroll', this._mousewheelHandler);

            this.root =
            this.storage =
            this.painter = null;
            
            this.un();
        },

        /**
         * 拖拽开始
         * 
         * @private
         * @param {Object} event 事件对象
         */
        _processDragStart: function (event) {
            var _lastHover = this._lastHover;

            if (this._isMouseDown
                && _lastHover
                && _lastHover.draggable
                && !this._draggingTarget
                && this._mouseDownTarget == _lastHover
            ) {
                // 拖拽点击生效时长阀门，某些场景需要降低拖拽敏感度
                if (_lastHover.dragEnableTime && 
                    new Date() - this._lastMouseDownMoment < _lastHover.dragEnableTime
                ) {
                    return;
                }

                var _draggingTarget = _lastHover;
                this._draggingTarget = _draggingTarget;
                this._isDragging = 1;

                // 分发config.EVENT.DRAGSTART事件
                this._dispatchAgency(
                    _draggingTarget,
                    EVENT.DRAGSTART,
                    event
                );
                this.painter.refresh();
            }
        },

        /**
         * 拖拽进入目标元素
         * 
         * @private
         * @param {Object} event 事件对象
         */
        _processDragEnter: function (event) {
            if (this._draggingTarget) {
                // 分发config.EVENT.DRAGENTER事件
                this._dispatchAgency(
                    this._lastHover,
                    EVENT.DRAGENTER,
                    event,
                    this._draggingTarget
                );
            }
        },

        /**
         * 拖拽在目标元素上移动
         * 
         * @private
         * @param {Object} event 事件对象
         */
        _processDragOver: function (event) {
            if (this._draggingTarget) {
                // 分发config.EVENT.DRAGOVER事件
                this._dispatchAgency(
                    this._lastHover,
                    EVENT.DRAGOVER,
                    event,
                    this._draggingTarget
                );
            }
        },

        /**
         * 拖拽离开目标元素
         * 
         * @private
         * @param {Object} event 事件对象
         */
        _processDragLeave: function (event) {
            if (this._draggingTarget) {
                // 分发config.EVENT.DRAGLEAVE事件
                this._dispatchAgency(
                    this._lastHover,
                    EVENT.DRAGLEAVE,
                    event,
                    this._draggingTarget
                );
            }
        },

        /**
         * 拖拽在目标元素上完成
         * 
         * @private
         * @param {Object} event 事件对象
         */
        _processDrop: function (event) {
            if (this._draggingTarget) {
                this._draggingTarget.dirty();
                this.painter.refresh();

                // 分发config.EVENT.DROP事件
                this._dispatchAgency(
                    this._lastHover,
                    EVENT.DROP,
                    event,
                    this._draggingTarget
                );
            }
        },

        /**
         * 拖拽结束
         * 
         * @private
         * @param {Object} event 事件对象
         */
        _processDragEnd: function (event) {
            if (this._draggingTarget) {
                // 分发config.EVENT.DRAGEND事件
                this._dispatchAgency(
                    this._draggingTarget,
                    EVENT.DRAGEND,
                    event
                );

                this._lastHover = null;
            }

            this._isDragging = 0;
            this._draggingTarget = null;
        },

        /**
         * 鼠标在某个图形元素上移动
         * 
         * @private
         * @param {Object} event 事件对象
         */
        _processOverShape: function (event) {
            // 分发config.EVENT.MOUSEOVER事件
            this._dispatchAgency(this._lastHover, EVENT.MOUSEOVER, event);
        },

        /**
         * 鼠标离开某个图形元素
         * 
         * @private
         * @param {Object} event 事件对象
         */
        _processOutShape: function (event) {
            // 分发config.EVENT.MOUSEOUT事件
            this._dispatchAgency(this._lastHover, EVENT.MOUSEOUT, event);
        },

        /**
         * 事件分发代理
         * 
         * @private
         * @param {Object} targetShape 目标图形元素
         * @param {string} eventName 事件名称
         * @param {Object} event 事件对象
         * @param {Object=} draggedShape 拖拽事件特有，当前被拖拽图形元素
         */
        _dispatchAgency: function (targetShape, eventName, event, draggedShape) {
            var eventHandler = 'on' + eventName;
            var eventPacket = {
                type: eventName,
                event: event,
                target: targetShape,
                cancelBubble: false
            };

            var el = targetShape;

            if (draggedShape) {
                eventPacket.dragged = draggedShape;
            }

            while (el) {
                el[eventHandler]
                && (eventPacket.cancelBubble = el[eventHandler].call(el, eventPacket));
                el.trigger(eventName, eventPacket);

                el = el.parent;

                if (eventPacket.cancelBubble) {
                    break;
                }
            }

            if (targetShape) {
                // 冒泡到顶级 zrender 对象
                if (!eventPacket.cancelBubble) {
                    this.trigger(eventName, eventPacket);
                }
            }
            else if (!draggedShape) {
                // 无hover目标，无拖拽对象，原生事件分发
                var eveObj = {
                    type: eventName,
                    event: event
                };
                this.trigger(eventName, eveObj);
                // 分发事件到用户自定义层
                this.painter.eachOtherLayer(function (layer) {
                    if (typeof(layer[eventHandler]) == 'function') {
                        layer[eventHandler].call(layer, eveObj);
                    }
                    if (layer.trigger) {
                        layer.trigger(eventName, eveObj);
                    }
                });
            }
        },

        /**
         * 迭代寻找hover shape
         * @private
         * @method
         */
        _iterateAndFindHover: function() {
            var list = this.storage.getDisplayList();
            for (var i = list.length - 1; i >= 0 ; i--) {
                if (this._isHover(list[i], this._mouseX, this._mouseY)) {
                    break;
                }
            }
        },

        // touch有指尖错觉，四向尝试，让touch上的点击更好触发事件
        _mobileFindFixed: function (event) {
            this._lastHover = null;
            this._mouseX = event.zrenderX;
            this._mouseY = event.zrenderY;

            this._event = event;

            this._iterateAndFindHover();
            for (var i = 0; !this._lastHover && i < MOBILE_TOUCH_OFFSETS.length ; i++) {
                var offset = MOBILE_TOUCH_OFFSETS[ i ];
                offset.x && (this._mouseX += offset.x);
                offset.y && (this._mouseY += offset.y);

                this._iterateAndFindHover();
            }

            if (this._lastHover) {
                event.zrenderX = this._mouseX;
                event.zrenderY = this._mouseY;
            }
        },

        /**
         * 迭代函数，查找hover到的图形元素并即时做些事件分发
         * 
         * @inner
         * @param {Object} shape 图形元素
         * @param {number} x
         * @param {number} y
         */
        _isHover: function(shape, x, y) {
            if (
                (this._draggingTarget && this._draggingTarget == shape) // 迭代到当前拖拽的图形上
                || shape.isSilent() // 打酱油的路过，啥都不响应的shape~
            ) {
                return false;
            }

            var event = this._event;
            if (shape.contain(x, y)) {
                if (shape.hoverable) {
                    // this.storage.addHover(shape);
                }
                // 查找是否在 clipPath 中
                var p = shape.parent;
                while (p) {
                    if (p.clipPath && !p.clipPath.contain(x, y))  {
                        console.log(p.clipPath.contain(x, y));
                        // 已经被祖先 clip 掉了
                        return false;
                    }
                    p = p.parent;
                }

                if (this._lastHover != shape) {
                    this._processOutShape(event);

                    // 可能出现config.EVENT.DRAGLEAVE事件
                    this._processDragLeave(event);

                    this._lastHover = shape;

                    this._processOverShape(event);

                    // 可能出现config.EVENT.DRAGENTER事件
                    this._processDragEnter(event);
                }

                // 可能出现config.EVENT.DRAGOVER
                this._processDragOver(event);

                this._hasfound = 1;

                return true;    // 找到则中断迭代查找
            }

            return false;
        }
    };

    util.merge(Handler.prototype, Eventful.prototype, true);

    return Handler;
});
