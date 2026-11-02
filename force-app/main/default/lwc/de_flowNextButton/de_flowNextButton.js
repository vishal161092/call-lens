import { LightningElement } from 'lwc';
import { FlowNavigationNextEvent } from 'lightning/flowSupport';

export default class De_flowNextButton extends LightningElement {

    handleNext() {
        this.dispatchEvent(new FlowNavigationNextEvent());
    }

}