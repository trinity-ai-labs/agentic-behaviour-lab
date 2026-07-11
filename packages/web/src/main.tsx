import { render } from "solid-js/web"
import { App } from "./app"
import "./tokens/tokens.primitives.css"
import "./tokens/themes/rime.css"
import "./tokens/themes/ledger.css"
import "./styles/global.css"

const root = document.getElementById("root")
if (root === null) throw new Error("#root element not found")

render(() => <App />, root)
