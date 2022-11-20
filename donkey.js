function createElement(type, props, ...children) {
  return {
    type,
    props: {
      ...props,
      children: children.map((child) =>
        typeof child === "object" ? child : createTextElement(child)
      ),
    },
  };
}

function createTextElement(text) {
  return {
    type: "TEXT_ELEMENT",
    props: {
      nodeValue: text,
      children: [],
    },
  };
}

function createDom(fiber) {
  const dom =
    // 区分文本节点和普通节点
    fiber.type === "TEXT_ELEMENT"
      ? document.createTextNode("")
      : document.createElement(fiber.type);
  // 添加属性
  //   const isProperty = (key) => key !== "children";
  //   Object.keys(fiber.props)
  //     .filter(isProperty)
  //     .forEach((name) => {
  //       dom[name] = fiber.props[name];
  //     });
  updateDom(dom, {}, fiber.props);
  return dom;
}

const isEvent = (key) => key.startsWith("on");
const isProperty = (key) => key !== "children" && !isEvent(key);
const isNew = (prev, next) => (key) => prev[key] !== next[key];
const isGone = (prev, next) => (key) => !(key in next);
function updateDom(fiber, oldProps, newProps) {
  // 移除旧的或已变更的旧事件监听
  Object.keys(oldProps)
    .filter(isEvent)
    .filter((key) => !(key in newProps) || isNew(oldProps, newProps)(key))
    .forEach((name) => {
      const eventType = name.toLowerCase().substring(2);
      fiber.removeEventListener(eventType, oldProps[name]);
    });
  // 移除老的属性
  Object.keys(oldProps)
    .filter(isProperty)
    .filter(isGone(oldProps, newProps))
    .forEach((name) => {
      fiber[name] = "";
    });

  // 添加和更新新的属性
  Object.keys(newProps)
    .filter(isProperty)
    .filter(isNew(oldProps, newProps))
    .forEach((name) => {
      fiber[name] = newProps[name];
    });

  // 添加新的时间监听
  Object.keys(newProps)
    .filter(isEvent)
    .filter(isNew(oldProps, newProps))
    .forEach((name) => {
      const eventType = name.toLowerCase().substring(2);
      fiber.addEventListener(eventType, newProps[name]);
    });
}

function render(element, container) {
  wipRoot = {
    dom: container,
    props: {
      children: [element],
    },
    alternate: currentRoot,
  };
  deletions = [];
  nextUnitOfWork = wipRoot;
}

function commitDeletion(fiber, domParent) {
  if (fiber.dom) {
    domParent.removeChild(fiber.dom);
  } else {
    commitDeletion(fiber.child, domParent);
  }
}

function commitWork(fiber) {
  if (!fiber) {
    return;
  }
  // 由于函数式组件无dom，需递归添一直往父节点查找
  let domParentFiber = fiber.parent;
  while (!domParentFiber.dom) {
    domParentFiber = domParentFiber.parent;
  }
  const domParent = domParentFiber.dom;
  if (fiber.effectTag === "PLACEMENT" && fiber.dom !== null) {
    domParent.appendChild(fiber.dom);
  } else if (fiber.effectTag === "DELETION") {
    commitDeletion(fiber, domParent);
  } else if (fiber.effectTag === "UPDATE" && fiber.dom !== null) {
    updateDom(fiber.dom, fiber.alternate.props, fiber.props);
  }
  commitWork(fiber.child);
  commitWork(fiber.sibling);
}

function commitRoot() {
  // 提交需要移除的节点
  deletions.forEach(commitWork);
  commitWork(wipRoot.child);
  currentRoot = wipRoot;
  wipRoot = null;
}

let nextUnitOfWork = null;
let wipRoot = null;
let currentRoot = null;
let deletions = null;
let wipFiber = null;
let hookIndex = null;

function workLoop(deadline) {
  let shouldYield = false;
  while (nextUnitOfWork && !shouldYield) {
    nextUnitOfWork = performUnitOfWork(nextUnitOfWork);
    shouldYield = deadline.timeRemaining() < 1;
  }

  // 完成wipRoot后，提交到实际的DOM中去
  if (!nextUnitOfWork && wipRoot) {
    commitRoot();
  }

  requestIdleCallback(workLoop);
}

requestIdleCallback(workLoop);

function reconcileChildren(wipFiber, elements) {
  let index = 0;
  let oldFiber = wipFiber.alternate && wipFiber.alternate.child;
  let prevSibling = null;

  while (index < elements.length || oldFiber !== null) {
    const element = elements[index];
    // 创建新的子节点fiber
    let newFiber = null;

    const sameType = newFiber && oldFiber && newFiber.type == oldFiber.type;
    // 新旧节点类型一样，更新属性
    if (sameType) {
      newFiber = {
        type: oldFiber.type,
        props: element.props,
        parent: wipFiber,
        alternate: oldFiber,
        dom: oldFiber.dom,
        effectTag: "UPDATE",
      };
    }
    // 新旧节点不一样，需要新生成节点
    if (element && !sameType) {
      newFiber = {
        type: element.type,
        props: element.props,
        parent: wipFiber,
        alternate: null,
        dom: null,
        effectTag: "PLACEMENT",
      };
    }
    // 新旧节点不一样，且旧节点依然存在，需要把旧节点删除
    if (oldFiber && !sameType) {
      oldFiber.effectTag = "DELETION";
      deletions.push(oldFiber);
    }
    // 设置父节点指向第一个子节点
    if (index === 0) {
      wipFiber.child = newFiber;
    } else if (element) {
      // 设置上一个节点的兄弟节点指向
      prevSibling.sibling = newFiber;
    }

    prevSibling = newFiber;
    index++;
  }
}

// diff类与原生组件
function updateHostComponent(fiber) {
  if (!fiber.dom) {
    fiber.dom = createDom(fiber);
  }
  // 子节点创建对应新的fiber节点
  const elements = fiber.props.children;
  reconcileChildren(fiber, elements);
}

// diff函数式组件
function updateFunctionComponent(fiber) {
  wipFiber = fiber;
  hookIndex = 0;
  wipFiber.hooks = [];
  const children = [fiber.type(fiber.props)];
  reconcileChildren(fiber, children);
}

function useState(initial) {
  const oldHook =
    wipFiber.alternate &&
    wipFiber.alternate.hooks &&
    wipFiber.alternate.hooks[hookIndex];
  const hook = {
    state: oldHook ? oldHook.state : initial,
    queue: [],
  };

  // 下轮循环开始调用
  const actions = oldHook ? oldHook.queue : [];
  actions.forEach((action) => {
    hook.state = action(hook.state);
  });

  // 添加所有的调用队列
  const setState = (action) => {
    hook.queue.push(action);
    wipRoot = {
      dom: currentRoot.dom,
      props: currentRoot.props,
      alternate: currentRoot,
    };
    nextUnitOfWork = wipRoot;
    deletions = [];
  };

  wipFiber.hooks.push(hook);
  hookIndex++;
  return [hook.state, setState];
}

function performUnitOfWork(fiber) {
  // 判断组件类型，并进行相应的逻辑
  const isFunctionComponent = fiber.type instanceof Function;
  if (isFunctionComponent) {
    updateFunctionComponent(fiber);
  } else {
    updateHostComponent(fiber);
  }

  // 寻找下一个工作单元，先child, 再sibling, 后uncle
  if (fiber.child) {
    return fiber.child;
  }
  let newFiber = fiber;
  while (newFiber) {
    if (newFiber.sibling) {
      return newFiber.sibling;
    }
    newFiber = newFiber.parent;
  }
}

const Donkey = {
  createElement,
  render,
  useState,
};

// test
// 1.
// const element = <h1 title="foo">你好</h1>;
// const element = createElement(
//   "h1",
//   {
//     title: "foo",
//   },
//   "你好"
// );
// 2.
// 函数式组件
// function App(props) {
//   return <h1>hi, {props.name}</h1>;
// }
// const element = <App name="兄弟" />;
// 经babel编译后：
// function App(props) {
//   return createElement("h1", null, "hi, ", props.name);
// }
// const element = createElement(App, {
//   name: "兄弟",
// });
// 3.
// 有状态的函数式组件
// function Counter() {
//   const [state, setState] = Donkey.setState(1);
//   return (
//     <h1
//       onClick={() => {
//         setState((c) => c + 1);
//       }}
//     >
//       {state}
//     </h1>
//   );
// }
// const element = <Counter />;
// 经babel编译后：
function Counter() {
  const [state, setState] = useState(1);
  return createElement(
    "h1",
    {
      onClick: () => {
        setState((c) => c + 1);
      },
    },
    state
  );
}
const element = createElement(Counter, {});

const container = document.getElementById("root");
Donkey.render(element, container);
